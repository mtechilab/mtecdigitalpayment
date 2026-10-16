/** Rules for read receipts, replies, deleting, reactions and typing. No database or network imports. */
export const REACTION_KEYS = ["like", "love", "laugh", "wow", "sad", "pray"] as const;
export type ReactionKey = typeof REACTION_KEYS[number];
export const TYPING_SECONDS = 6;
export const PREVIEW_CHARS = 80;

export function validateReaction(key: unknown): key is ReactionKey {
  return typeof key === "string" && (REACTION_KEYS as readonly string[]).includes(key);
}

/** "me" hides the message for the person who deleted it; "everyone" removes it for all, sender only. */
export function deleteScope(raw: unknown): "me" | "everyone" | null {
  return raw === "me" || raw === "everyone" ? raw : null;
}

/** A message counts as read once the reader's last-read time is at or after the message's time. */
export function isReadBy(readAt: string, sentAt: string): boolean {
  return new Date(readAt).getTime() >= new Date(sentAt).getTime();
}

/** The short text shown when a message is quoted in a reply. */
export function previewOf(body: string | null, kind: string, deleted: boolean): string {
  if (deleted) return "This message was deleted";
  if (kind === "voice") return "Voice note";
  if (kind === "image") return "Photo";
  if (kind === "file") return "Document";
  const t = (body || "").replace(/\s+/g, " ").trim();
  return t.length > PREVIEW_CHARS ? t.slice(0, PREVIEW_CHARS - 3) + "..." : t;
}

/** Typing is shown for a few seconds after the last typing signal. */
export function isTypingNow(updatedAt: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(updatedAt).getTime() <= TYPING_SECONDS * 1000;
}
