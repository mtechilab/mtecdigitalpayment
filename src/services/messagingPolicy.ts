/** MTeC Connect rules. No database or network imports, so they can be tested directly. */
export const MAX_TEXT_CHARS = 2000;
export const MAX_VOICE_SECONDS = 120;
export const MAX_VOICE_BYTES = 2 * 1024 * 1024;
export const VOICE_TYPES = ["audio/mp4", "audio/aac", "audio/3gpp", "audio/ogg", "audio/webm"] as const;

export function validateText(body: string): string | null {
  const t = body.trim();
  if (t.length < 1) return "Write a message before you send it.";
  if (t.length > MAX_TEXT_CHARS) return `Keep messages under ${MAX_TEXT_CHARS} characters.`;
  return null;
}

export function validateVoice(contentType: string, base64: string, seconds: number): string | null {
  if (!(VOICE_TYPES as readonly string[]).includes(contentType)) return "That recording format is not supported.";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return "The recording could not be read.";
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes <= 0) return "The recording is empty.";
  if (bytes > MAX_VOICE_BYTES) return "The recording is larger than 2 MB. Keep it under 2 minutes.";
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_VOICE_SECONDS) return "A voice note can be 1 to 120 seconds long.";
  return null;
}

/** Whether a message can be read or sent in a group, given the rule that applies to it. */
export function groupAccessRule(kind: string): "all-students-of-programme" | "class-members" | "direct-members" {
  if (kind === "programme") return "all-students-of-programme";
  if (kind === "class") return "class-members";
  return "direct-members";
}

export function unreadCount(messagesAfterRead: { senderKind: string; senderId: string }[], viewerKind: string, viewerId: string): number {
  return messagesAfterRead.filter((m) => !(m.senderKind === viewerKind && m.senderId === viewerId)).length;
}
