/** News and notice rules. No database or network imports, so they can be tested directly. */
export const POST_KINDS = ["news", "notice"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function validatePost(input: { kind: unknown; title: unknown; body: unknown; audience: unknown; expiresAt: unknown }): string | null {
  if (!(POST_KINDS as readonly string[]).includes(input.kind as string)) return "Choose News or Notice.";
  if (typeof input.title !== "string" || input.title.trim().length < 3 || input.title.trim().length > 120) return "The title must be 3 to 120 characters.";
  if (typeof input.body !== "string" || input.body.trim().length < 3 || input.body.trim().length > 4000) return "The message must be 3 to 4000 characters.";
  if (typeof input.audience !== "string" || input.audience.trim().length < 1) return "Choose who should see it.";
  if (input.expiresAt !== null && input.expiresAt !== undefined && input.expiresAt !== "") {
    const t = new Date(String(input.expiresAt)).getTime();
    if (!Number.isFinite(t) || t <= Date.now()) return "The expiry date must be in the future.";
  }
  return null;
}

export function validateImage(contentType: unknown, base64: unknown): string | null {
  if (contentType !== "image/jpeg" && contentType !== "image/png" && contentType !== "image/webp") return "The image must be a JPG, PNG or WEBP photo.";
  if (typeof base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return "The image could not be read.";
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes <= 0) return "The image is empty.";
  if (bytes > MAX_IMAGE_BYTES) return "The image is larger than 5 MB.";
  return null;
}

/** A post is visible to everyone, or to students on the programme it was written for, until it expires. */
export function isVisible(audience: string, expiresAt: string | null, studentProgramme: string, now: Date = new Date()): boolean {
  if (expiresAt && new Date(expiresAt).getTime() <= now.getTime()) return false;
  return audience === "all" || audience === studentProgramme;
}
