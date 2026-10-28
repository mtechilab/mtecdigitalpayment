import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";

const BUCKET = "checkin-evidence";
const MAX_BYTES = 5 * 1024 * 1024;
const LINK_SECONDS = 300;
const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Loose = { from(t: string): any; storage: any };
const db = (): Loose => getSupabase() as unknown as Loose;

function checkFile(contentType: unknown, base64: unknown): string | null {
  if (typeof contentType !== "string" || !TYPES[contentType]) return "Attach a photo (JPG, PNG or WEBP) or a PDF.";
  if (typeof base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return "The file could not be read.";
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes <= 0) return "The file is empty.";
  if (bytes > MAX_BYTES) return "The file is larger than 5 MB.";
  return null;
}

/** Stores one piece of evidence on the student's own draft. The reply is sent only after the file is stored. */
export async function addAttachment(studentRowId: string, input: {
  checkinId: string; attachmentId: string; contentType: unknown; fileBase64: unknown; fileName?: string;
}) {
  if (!UUID.test(input.attachmentId || "")) throw new Error("The upload is missing its reference.");
  const problem = checkFile(input.contentType, input.fileBase64);
  if (problem) throw new Error(problem);
  const { data: checkin } = await db().from("project_checkins").select("id, status, student_row_id")
    .eq("id", input.checkinId).maybeSingle();
  if (!checkin || checkin.student_row_id !== studentRowId) throw new Error("That check-in was not found.");
  if (checkin.status !== "draft") throw new Error("This check-in is already submitted, so nothing can be added to it.");

  const { data: already } = await db().from("project_checkin_attachments").select("id").eq("id", input.attachmentId).maybeSingle();
  if (already) return { id: input.attachmentId, duplicate: true };

  const path = `${studentRowId}/${input.checkinId}/${input.attachmentId}.${TYPES[input.contentType as string]}`;
  const buffer = Buffer.from(input.fileBase64 as string, "base64");
  const { error: upErr } = await db().storage.from(BUCKET).upload(path, buffer, { contentType: input.contentType as string, upsert: false });
  if (upErr) throw new Error(`The file could not be stored: ${upErr.message}`);
  const { error } = await db().from("project_checkin_attachments").insert({
    id: input.attachmentId, checkin_id: input.checkinId, student_row_id: studentRowId, file_path: path,
    file_type: input.contentType as string, size_bytes: buffer.length, original_name: (input.fileName || "").slice(0, 120),
  });
  if (error) {
    await db().storage.from(BUCKET).remove([path]);
    throw new Error(`The file could not be saved: ${error.message}`);
  }
  await recordAudit({ actor: studentRowId, action: "checkin.attachment", entityType: "project_checkin", entityId: input.checkinId, detail: { attachment: input.attachmentId } });
  return { id: input.attachmentId, duplicate: false };
}

export async function listAttachments(checkinId: string) {
  const { data, error } = await db().from("project_checkin_attachments")
    .select("id, file_type, size_bytes, original_name, uploaded_at").eq("checkin_id", checkinId).order("uploaded_at", { ascending: true });
  if (error) throw new Error(`Could not load the evidence: ${error.message}`);
  return data || [];
}

/** A short-lived link to one attachment. Students see their own; lecturers see those on projects they own. */
export async function attachmentLink(attachmentId: string, viewer: { studentRowId?: string; canViewPath?: (checkinId: string) => Promise<boolean> }) {
  const { data, error } = await db().from("project_checkin_attachments").select("checkin_id, student_row_id, file_path")
    .eq("id", attachmentId).maybeSingle();
  if (error) throw new Error(`Could not open the file: ${error.message}`);
  if (!data) throw new Error("That file was not found.");
  if (viewer.studentRowId !== undefined && data.student_row_id !== viewer.studentRowId) throw new Error("That file was not found.");
  if (viewer.canViewPath && !(await viewer.canViewPath(data.checkin_id))) throw new Error("That file was not found.");
  const { data: signed, error: sErr } = await db().storage.from(BUCKET).createSignedUrl(data.file_path, LINK_SECONDS);
  if (sErr || !signed) throw new Error(`Could not create the link: ${sErr?.message || "unknown"}`);
  return { url: signed.signedUrl, expiresInSeconds: LINK_SECONDS };
}
