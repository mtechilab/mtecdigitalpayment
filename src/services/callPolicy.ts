/** In-app call rules. No database or network imports, so they can be tested directly. */
export const RING_SECONDS = 60;
export const MAX_SIGNAL_CHARS = 20000;
/** A live call is checked by both phones about every 1.5 seconds; silence for longer means it has ended. */
export const HEARTBEAT_SECONDS = 30;
export const SIGNAL_KINDS = ["offer", "answer", "ice", "hangup"] as const;

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

/** The public STUN server finds the phone's address. It does not carry the call, so calls can still
 *  fail on networks that block direct connections; a TURN relay is set through ICE_SERVERS_JSON. */
export const DEFAULT_ICE_SERVERS: IceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];

export function validateCallMode(mode: unknown): mode is "audio" | "video" {
  return mode === "audio" || mode === "video";
}

export function validateSignal(kind: unknown, payload: unknown): string | null {
  if (typeof kind !== "string" || !(SIGNAL_KINDS as readonly string[]).includes(kind)) return "That signal is not recognised.";
  if (payload === null || typeof payload !== "object") return "The signal payload is missing.";
  if (JSON.stringify(payload).length > MAX_SIGNAL_CHARS) return "The signal is too large.";
  return null;
}

/** A call that has rung for longer than the limit with no answer is treated as missed. */
export function isRingExpired(createdAt: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() > RING_SECONDS * 1000;
}

export function durationSeconds(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
}

/** Reads ICE_SERVERS_JSON. Anything malformed falls back to the default STUN server. */
export function parseIceServers(raw: string | undefined): IceServer[] {
  if (!raw || raw.trim() === "") return DEFAULT_ICE_SERVERS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ICE_SERVERS;
    for (const server of parsed) {
      const ok = server && (typeof server.urls === "string" || Array.isArray(server.urls));
      if (!ok) return DEFAULT_ICE_SERVERS;
    }
    return parsed as IceServer[];
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

export function isHeartbeatStale(lastSeen: string | null, now: Date = new Date()): boolean {
  if (!lastSeen) return true;
  return now.getTime() - new Date(lastSeen).getTime() > HEARTBEAT_SECONDS * 1000;
}
