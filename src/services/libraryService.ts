import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { validateLibraryUpload, validateLibraryFile, LibraryUploadInput } from "./libraryValidation.js";

const BUCKET = "library";
const SIGNED_URL_SECONDS = 300;
const LIST_COLUMNS = "id, title, description, programme, course_code, semester, academic_year, topic, material_type, status, current_version, published_version, published_at, uploaded_by_name, created_at";

export interface LibraryFilters {
  programme?: string;
  courseCode?: string;
  semester?: string;
  academicYear?: string;
  materialType?: string;
  search?: string;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Stores one file in the private bucket under a server-chosen path, then records it. */
async function storeVersion(itemId: string, version: number, file: { ext: string; fileName: string; contentType: string; sizeBytes: number; fileBase64: string }, uploaderName: string) {
  const supabase = getSupabase();
  const path = `${itemId}/v${version}-${Date.now()}.${file.ext}`;
  const bytes = Buffer.from(file.fileBase64, "base64");
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: file.contentType, upsert: false });
  if (uploadError) throw new Error(`Could not store the file: ${uploadError.message}`);

  const { error } = await supabase.from("library_versions").insert({
    item_id: itemId, version, storage_path: path, file_name: file.fileName,
    content_type: file.contentType, size_bytes: file.sizeBytes, uploaded_by_name: uploaderName,
  });
  if (error) {
    // Don't leave an orphaned file behind a failed record.
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`Could not record the file: ${error.message}`);
  }
}

/** A lecturer uploads new material. It waits for admin approval before students can see it. */
export async function createLibraryItem(actor: { id: string; name: string }, input: LibraryUploadInput & {
  description?: string; courseCode?: string; semester?: string; topic?: string;
}) {
  const check = validateLibraryUpload(input);
  if (!check.ok) throw new Error(check.error);
  const supabase = getSupabase();

  const { data: item, error } = await supabase.from("library_items").insert({
    title: input.title.trim(),
    description: (input.description || "").trim(),
    programme: input.programme.trim(),
    course_code: (input.courseCode || "").trim(),
    semester: (input.semester || "").trim(),
    academic_year: input.academicYear.trim(),
    topic: (input.topic || "").trim(),
    material_type: check.materialType,
    status: "pending_approval",
    uploaded_by_staff_id: actor.id,
    uploaded_by_name: actor.name,
    current_version: 1,
    published_version: null,
  }).select("id").single();
  if (error) throw new Error(`createLibraryItem failed: ${error.message}`);

  await storeVersion(item.id as string, 1, { ext: check.ext, fileName: check.fileName, contentType: input.contentType, sizeBytes: check.sizeBytes, fileBase64: input.fileBase64 }, actor.name);
  await recordAudit({ actor: actor.name, action: "library.upload", entityType: "library_item", entityId: item.id as string, detail: { version: 1 } });
  return { id: item.id as string, status: "pending_approval" };
}

/** A lecturer replaces the material with a new version. Students keep the published one until this is approved. */
export async function addLibraryVersion(actor: { id: string; name: string; role?: string }, itemId: string, input: { fileName: string; contentType: string; fileBase64: string }) {
  const check = validateLibraryFile(input);
  if (!check.ok) throw new Error(check.error);
  const supabase = getSupabase();

  const { data: item, error } = await supabase.from("library_items")
    .select("id, uploaded_by_staff_id, current_version").eq("id", itemId).maybeSingle();
  if (error) throw new Error(`addLibraryVersion failed: ${error.message}`);
  if (!item) throw new Error("That item was not found.");
  const administrator = actor.role === "administrator";
  if (item.uploaded_by_staff_id !== actor.id && !administrator) {
    throw new Error("You can only add versions to material you uploaded.");
  }

  const next = (item.current_version as number) + 1;
  await storeVersion(itemId, next, { ext: check.ext, fileName: check.fileName, contentType: input.contentType, sizeBytes: check.sizeBytes, fileBase64: input.fileBase64 }, actor.name);
  const { error: updateError } = await supabase.from("library_items")
    .update({ current_version: next, status: "pending_approval" }).eq("id", itemId);
  if (updateError) throw new Error(`addLibraryVersion (update) failed: ${updateError.message}`);
  await recordAudit({ actor: actor.name, action: "library.new_version", entityType: "library_item", entityId: itemId, detail: { version: next } });
  return { id: itemId, version: next, status: "pending_approval" };
}

export async function approveLibraryItem(adminName: string, itemId: string) {
  const supabase = getSupabase();
  const { data: item, error } = await supabase.from("library_items").select("id, current_version").eq("id", itemId).maybeSingle();
  if (error) throw new Error(`approveLibraryItem failed: ${error.message}`);
  if (!item) throw new Error("That item was not found.");
  const { error: updateError } = await supabase.from("library_items").update({
    status: "published", published_version: item.current_version, published_at: new Date().toISOString(),
    approved_by: adminName, rejection_reason: null,
  }).eq("id", itemId);
  if (updateError) throw new Error(`approveLibraryItem (update) failed: ${updateError.message}`);
  await recordAudit({ actor: adminName, action: "library.approve", entityType: "library_item", entityId: itemId, detail: { version: item.current_version } });
  return { success: true };
}

export async function rejectLibraryItem(adminName: string, itemId: string, reason: string) {
  if (!reason.trim()) throw new Error("A reason is required.");
  const { error } = await getSupabase().from("library_items")
    .update({ status: "rejected", rejection_reason: reason.trim() }).eq("id", itemId);
  if (error) throw new Error(`rejectLibraryItem failed: ${error.message}`);
  await recordAudit({ actor: adminName, action: "library.reject", entityType: "library_item", entityId: itemId, detail: { reason: reason.trim() } });
  return { success: true };
}

function applyFilters<Q extends { eq: (c: string, v: string) => Q; ilike: (c: string, v: string) => Q }>(q: Q, f: LibraryFilters): Q {
  let out = q;
  if (f.programme) out = out.eq("programme", f.programme);
  if (f.semester) out = out.eq("semester", f.semester);
  if (f.academicYear) out = out.eq("academic_year", f.academicYear);
  if (f.materialType) out = out.eq("material_type", f.materialType);
  if (f.courseCode) out = out.ilike("course_code", escapeLike(f.courseCode));
  if (f.search) out = out.ilike("title", `%${escapeLike(f.search)}%`);
  return out;
}

/** Students see only published material. Lecturers see published material plus their own
 *  uploads, whatever their status. Admins see everything. */
export async function listLibrary(viewer: { role: "student" | "lecturer" | "admin"; staffId?: string }, filters: LibraryFilters) {
  const supabase = getSupabase();
  const published = () => applyFilters(
    supabase.from("library_items").select(LIST_COLUMNS).not("published_version", "is", null).order("published_at", { ascending: false }).limit(200),
    filters);

  if (viewer.role === "student") {
    const { data, error } = await published();
    if (error) throw new Error(`listLibrary failed: ${error.message}`);
    return data || [];
  }
  if (viewer.role === "admin") {
    const { data, error } = await applyFilters(
      supabase.from("library_items").select(LIST_COLUMNS).order("created_at", { ascending: false }).limit(200), filters);
    if (error) throw new Error(`listLibrary failed: ${error.message}`);
    return data || [];
  }
  // Lecturer: published material plus their own, merged without duplicates.
  const [pub, own] = await Promise.all([
    published(),
    applyFilters(supabase.from("library_items").select(LIST_COLUMNS).eq("uploaded_by_staff_id", viewer.staffId || "")
      .order("created_at", { ascending: false }).limit(200), filters),
  ]);
  if (pub.error) throw new Error(`listLibrary failed: ${pub.error.message}`);
  if (own.error) throw new Error(`listLibrary failed: ${own.error.message}`);
  const merged = new Map<string, Record<string, unknown>>();
  for (const row of [...(pub.data || []), ...(own.data || [])]) merged.set(row.id as string, row as Record<string, unknown>);
  return [...merged.values()];
}

/** A short-lived signed link to one file. Students get only the published version; a
 *  lecturer gets their own items; an admin gets anything. */
export async function getLibraryDownload(viewer: { role: "student" | "lecturer" | "admin"; staffId?: string }, itemId: string, requestedVersion?: number) {
  const supabase = getSupabase();
  const { data: item, error } = await supabase.from("library_items")
    .select("id, status, published_version, current_version, uploaded_by_staff_id").eq("id", itemId).maybeSingle();
  if (error) throw new Error(`getLibraryDownload failed: ${error.message}`);
  if (!item) throw new Error("That item was not found.");

  const isOwner = item.uploaded_by_staff_id === viewer.staffId && !!viewer.staffId;
  let version: number | null;
  if (viewer.role === "student") {
    if (item.published_version == null) throw new Error("That item is not available.");
    version = item.published_version as number;
  } else if (viewer.role === "lecturer" && !isOwner && item.published_version == null) {
    throw new Error("That item is not available.");
  } else {
    version = requestedVersion ?? (item.published_version as number | null) ?? (item.current_version as number);
  }

  const { data: fileRow, error: fileError } = await supabase.from("library_versions")
    .select("storage_path, file_name, content_type, version").eq("item_id", itemId).eq("version", version as number).maybeSingle();
  if (fileError) throw new Error(`getLibraryDownload (file) failed: ${fileError.message}`);
  if (!fileRow) throw new Error("That version was not found.");

  const { data: signed, error: signError } = await supabase.storage.from(BUCKET)
    .createSignedUrl(fileRow.storage_path as string, SIGNED_URL_SECONDS);
  if (signError || !signed) throw new Error(`Could not create the download link: ${signError?.message || "unknown"}`);
  return { url: signed.signedUrl, expiresInSeconds: SIGNED_URL_SECONDS, fileName: fileRow.file_name, contentType: fileRow.content_type, version: fileRow.version };
}
