/** Rules for library uploads. No database or crypto imports, so it can be tested directly. */
export const MAX_LIBRARY_BYTES = 5 * 1024 * 1024; // base64 adds a third, keeping the JSON body under the 8 MB limit

const ALLOWED: Record<string, { materialType: string; ext: string }> = {
  "application/pdf": { materialType: "pdf", ext: "pdf" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { materialType: "pptx", ext: "pptx" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { materialType: "docx", ext: "docx" },
  "image/jpeg": { materialType: "image", ext: "jpg" },
  "image/png": { materialType: "image", ext: "png" },
  "image/webp": { materialType: "image", ext: "webp" },
};

export interface LibraryUploadInput {
  title: string;
  programme: string;
  academicYear: string;
  fileName: string;
  contentType: string;
  fileBase64: string;
}

export type LibraryUploadCheck =
  | { ok: true; materialType: string; ext: string; fileName: string; sizeBytes: number }
  | { ok: false; error: string };

/** A safe display name: no folders, no unusual characters. The storage path never uses it. */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() || "file";
  return base.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120).trim() || "file";
}

/** Decoded size of a base64 string, without decoding it. */
export function decodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** The file itself: type, encoding and size. Used for both new items and new versions. */
export function validateLibraryFile(input: { fileName: string; contentType: string; fileBase64: string }): LibraryUploadCheck {
  const type = ALLOWED[input.contentType];
  if (!type) return { ok: false, error: "Upload a PDF, PowerPoint, Word document, or JPG, PNG or WEBP image." };

  if (!input.fileBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.fileBase64)) {
    return { ok: false, error: "The file could not be read." };
  }
  const sizeBytes = decodedBytes(input.fileBase64);
  if (sizeBytes <= 0) return { ok: false, error: "The file is empty." };
  if (sizeBytes > MAX_LIBRARY_BYTES) return { ok: false, error: "The file is larger than 5 MB." };

  return { ok: true, materialType: type.materialType, ext: type.ext, fileName: sanitizeFileName(input.fileName), sizeBytes };
}

export function validateLibraryUpload(input: LibraryUploadInput): LibraryUploadCheck {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 160) return { ok: false, error: "The title must be 3 to 160 characters." };
  if (!input.programme.trim()) return { ok: false, error: "Choose the programme." };
  if (!/^\d{4}(\/\d{4})?$/.test(input.academicYear.trim())) return { ok: false, error: "Academic year must look like 2026 or 2026/2027." };
  return validateLibraryFile(input);
}
