/** Attachment rules for chat. No database or network imports, so they can be tested directly. */
export const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const DOC_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

/** A safe display name: no folders, no unusual characters. Storage paths never use it. */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() || "file";
  return base.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120).trim() || "file";
}

export function decodedBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

export type ChatFileCheck =
  | { ok: true; kind: "image" | "file"; ext: string; fileName: string; size: number }
  | { ok: false; error: string };

export function validateChatFile(contentType: string, fileName: string, base64: string): ChatFileCheck {
  const image = IMAGE_TYPES[contentType];
  const doc = DOC_TYPES[contentType];
  if (!image && !doc) return { ok: false, error: "Send a photo (JPG, PNG or WEBP) or a PDF, Word or PowerPoint document." };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { ok: false, error: "The file could not be read." };
  const size = decodedBytes(base64);
  if (size <= 0) return { ok: false, error: "The file is empty." };
  if (image && size > MAX_IMAGE_BYTES) return { ok: false, error: "Photos must be 5 MB or smaller." };
  if (doc && size > MAX_DOC_BYTES) return { ok: false, error: "Documents must be 10 MB or smaller." };
  return { ok: true, kind: image ? "image" : "file", ext: image || doc, fileName: sanitizeFileName(fileName), size };
}
