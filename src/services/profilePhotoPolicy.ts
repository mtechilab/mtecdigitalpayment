/** Profile photo rules. No database or network imports, so they can be tested directly. */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export function validateProfilePhoto(contentType: string, base64: string): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(contentType)) return "The photo must be a JPG, PNG or WEBP image.";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return "The photo could not be read.";
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes <= 0) return "The photo is empty.";
  if (bytes > MAX_PHOTO_BYTES) return "The photo is larger than 2 MB. Choose a smaller one.";
  return null;
}

export function extensionFor(contentType: string): string {
  return contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
}
