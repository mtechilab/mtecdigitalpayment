import { randomUUID } from "crypto";
import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { validateReason } from "./adminDataPolicy.js";

const BUCKET = "official-results";
const MAX_BYTES = 5 * 1024 * 1024;
const LINK_SECONDS = 300;
const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function checkFile(contentType: unknown, base64: unknown): string | null {
  if (typeof contentType !== "string" || !TYPES[contentType]) return "The official copy must be a PDF, JPG, PNG or WEBP file.";
  if (typeof base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return "The file could not be read.";
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes <= 0) return "The file is empty.";
  if (bytes > MAX_BYTES) return "The file is larger than 5 MB.";
  return null;
}

/** Admin: store the official copy of a student's result for a semester. It is kept as the record. */
export async function uploadOfficialSlip(admin: string, input: {
  studentRowId: string; semester: string; academicYear: string; contentType: unknown; fileBase64: unknown;
}) {
  const problem = checkFile(input.contentType, input.fileBase64);
  if (problem) throw new Error(problem);
  const supabase = getSupabase();
  const { data: student } = await supabase.from("students").select("id").eq("id", input.studentRowId).maybeSingle();
  if (!student) throw new Error("Student not found.");
  const id = randomUUID();
  const path = `${input.studentRowId}/${id}.${TYPES[input.contentType as string]}`;
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, Buffer.from(input.fileBase64 as string, "base64"), { contentType: input.contentType as string, upsert: false });
  if (upErr) throw new Error(`Could not store the file: ${upErr.message}`);
  const { error } = await supabase.from("official_result_slips").insert({
    id, student_row_id: input.studentRowId, semester_name: input.semester, academic_year: input.academicYear,
    file_path: path, file_type: input.contentType as string, uploaded_by: admin,
  });
  if (error) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(`The copy could not be saved: ${error.message}`); }
  await recordAudit({ actor: admin, action: "result.official_upload", entityType: "student", entityId: input.studentRowId, detail: { semester: input.semester, slip: id } });
  return { id };
}

/** The slips for a student. Admins see removed ones too; students see only what is still on the statement. */
export async function listSlips(studentRowId: string, includeRemoved: boolean) {
  let query = getSupabase().from("official_result_slips")
    .select("id, semester_name, academic_year, file_type, uploaded_by, uploaded_at, removed, removed_by, removed_at, removed_reason")
    .eq("student_row_id", studentRowId).order("uploaded_at", { ascending: false });
  if (!includeRemoved) query = query.eq("removed", false);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load the copies: ${error.message}`);
  return data || [];
}

/** A short-lived link to one copy. A student may open only their own copy, and only while it is on the statement. */
export async function slipLink(slipId: string, viewer: { studentRowId?: string; admin?: boolean }) {
  const { data, error } = await getSupabase().from("official_result_slips").select("student_row_id, file_path, removed")
    .eq("id", slipId).maybeSingle();
  if (error) throw new Error(`Could not open the copy: ${error.message}`);
  const row = data as unknown as { student_row_id: string; file_path: string; removed: boolean } | null;
  if (!row) throw new Error("That copy was not found.");
  if (!viewer.admin && (row.removed || row.student_row_id !== viewer.studentRowId)) throw new Error("That copy was not found.");
  const { data: signed, error: signErr } = await getSupabase().storage.from(BUCKET).createSignedUrl(row.file_path, LINK_SECONDS);
  if (signErr || !signed) throw new Error(`Could not create the link: ${signErr?.message || "unknown"}`);
  return { url: signed.signedUrl, expiresInSeconds: LINK_SECONDS };
}

/** Admin: take a copy off the statement. The record and its file are kept. */
export async function removeSlip(admin: string, slipId: string, reason: unknown) {
  const problem = validateReason(reason);
  if (problem) throw new Error(problem);
  const { error } = await getSupabase().from("official_result_slips").update({
    removed: true, removed_by: admin, removed_at: new Date().toISOString(), removed_reason: String(reason).trim(),
  }).eq("id", slipId);
  if (error) throw new Error(`The copy could not be removed: ${error.message}`);
  await recordAudit({ actor: admin, action: "result.official_remove", entityType: "official_result_slip", entityId: slipId, detail: { reason: String(reason).trim() } });
  return { success: true };
}

/** Admin: put a removed copy back on the statement. */
export async function restoreSlip(admin: string, slipId: string, reason: unknown) {
  const problem = validateReason(reason);
  if (problem) throw new Error(problem);
  const { error } = await getSupabase().from("official_result_slips").update({
    removed: false, removed_by: null, removed_at: null, removed_reason: null,
  }).eq("id", slipId);
  if (error) throw new Error(`The copy could not be restored: ${error.message}`);
  await recordAudit({ actor: admin, action: "result.official_restore", entityType: "official_result_slip", entityId: slipId, detail: { reason: String(reason).trim() } });
  return { success: true };
}

/** Admin: publish or unpublish a class's results. Unpublished results do not show to students or count toward CGPA. */
export async function setBatchPublished(admin: string, classId: string, publish: boolean, reason: unknown) {
  const problem = validateReason(reason);
  if (problem) throw new Error(problem);
  const status = publish ? "published" : "draft";
  const { error } = await getSupabase().from("result_batches").update({ status }).eq("class_id", classId);
  if (error) throw new Error(`The results could not be ${publish ? "published" : "unpublished"}: ${error.message}`);
  await recordAudit({ actor: admin, action: publish ? "result.publish" : "result.unpublish", entityType: "class", entityId: classId, detail: { reason: String(reason).trim() } });
  return { success: true, status };
}
