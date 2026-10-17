import { getSupabase } from "../db/supabaseClient.js";
import { Viewer, studentViewer } from "./messagingService.js";
import { isRingExpired, isHeartbeatStale, durationSeconds, validateCallMode, validateSignal } from "./callPolicy.js";

interface CallRow {
  id: string; conversation_id: string; caller_kind: string; caller_id: string; caller_name: string;
  callee_kind: string; callee_id: string; mode: string; status: string; created_at: string;
  answered_at: string | null; ended_at: string | null; duration_seconds: number | null;
}

interface SignalRow { id: number; from_kind: string; from_id: string; to_kind: string; to_id: string; kind: string; payload: unknown }

function sameAs(kind: string, id: string, viewer: Viewer): boolean {
  return kind === viewer.kind && id === viewer.id;
}

async function loadCall(callId: string): Promise<CallRow> {
  const { data, error } = await getSupabase().from("calls").select("*").eq("id", callId).maybeSingle();
  if (error) throw new Error(`loadCall failed: ${error.message}`);
  if (!data) throw new Error("That call was not found.");
  return data as unknown as CallRow;
}

/** Only the two people in the call can see or change it. */
function participantRole(call: CallRow, viewer: Viewer): "caller" | "callee" {
  if (sameAs(call.caller_kind, call.caller_id, viewer)) return "caller";
  if (sameAs(call.callee_kind, call.callee_id, viewer)) return "callee";
  throw new Error("That call was not found.");
}

/** The other person in a direct chat. Calls are only allowed between two people in one direct chat. */
async function otherInDirectChat(viewer: Viewer, conversationId: string) {
  const supabase = getSupabase();
  const { data: conv } = await supabase.from("conversations").select("id, kind").eq("id", conversationId).maybeSingle();
  if (!conv || (conv as { kind: string }).kind !== "direct") throw new Error("Calls are available in direct chats.");
  const { data: members } = await supabase.from("conversation_members")
    .select("member_kind, member_id, member_name").eq("conversation_id", conversationId);
  const list = (members || []) as unknown as { member_kind: string; member_id: string; member_name: string }[];
  if (list.length !== 2 || !list.some((m) => sameAs(m.member_kind, m.member_id, viewer))) {
    throw new Error("That conversation was not found.");
  }
  const other = list.find((m) => !sameAs(m.member_kind, m.member_id, viewer));
  if (!other) throw new Error("That conversation was not found.");
  return { kind: other.member_kind, id: other.member_id, name: other.member_name };
}

/** Closes calls that can no longer be live: unanswered ones past the ring window, and answered ones
 *  whose people have stopped checking in. This is what stops a crashed call from blocking the chat. */
async function clearStaleCalls(conversationId: string) {
  const supabase = getSupabase();
  const { data } = await supabase.from("calls").select("id, status, created_at, answered_at, last_seen_at")
    .eq("conversation_id", conversationId).in("status", ["ringing", "active"]);
  const now = new Date();
  const rows = (data || []) as unknown as { id: string; status: string; created_at: string; answered_at: string | null; last_seen_at: string | null }[];
  for (const c of rows) {
    if (c.status === "ringing" && isRingExpired(c.created_at, now)) {
      await supabase.from("calls").update({ status: "cancelled", ended_at: now.toISOString() }).eq("id", c.id);
    } else if (c.status === "active" && isHeartbeatStale(c.last_seen_at, now)) {
      const endedAt = now.toISOString();
      const duration = durationSeconds(c.answered_at || c.created_at, endedAt);
      await supabase.from("calls").update({ status: "ended", ended_at: endedAt, duration_seconds: duration }).eq("id", c.id);
    }
  }
}

export async function startCall(viewer: Viewer, conversationId: string, mode: unknown) {
  if (!validateCallMode(mode)) throw new Error("Choose a voice or video call.");
  const other = await otherInDirectChat(viewer, conversationId);
  const supabase = getSupabase();

  await clearStaleCalls(conversationId);
  const { data: open } = await supabase.from("calls").select("id")
    .eq("conversation_id", conversationId).in("status", ["ringing", "active"]);
  if ((open || []).length > 0) throw new Error("A call is already in progress in this chat.");

  const { data, error } = await supabase.from("calls").insert({
    conversation_id: conversationId, caller_kind: viewer.kind, caller_id: viewer.id, caller_name: viewer.name,
    callee_kind: other.kind, callee_id: other.id, mode, status: "ringing",
  }).select("id").single();
  if (error) throw new Error(`startCall failed: ${error.message}`);
  return { callId: (data as { id: string }).id, mode, status: "ringing" };
}

/** Calls ringing for this person, that have not timed out. */
export async function incomingCalls(viewer: Viewer) {
  const { data, error } = await getSupabase().from("calls")
    .select("id, conversation_id, caller_name, mode, status, created_at")
    .eq("callee_kind", viewer.kind).eq("callee_id", viewer.id).eq("status", "ringing")
    .order("created_at", { ascending: false }).limit(5);
  if (error) throw new Error(`incomingCalls failed: ${error.message}`);
  const rows = (data || []) as unknown as { id: string; conversation_id: string; caller_name: string; mode: string; created_at: string }[];
  return rows.filter((c) => !isRingExpired(c.created_at)).map((c) => ({
    callId: c.id, conversationId: c.conversation_id, callerName: c.caller_name, mode: c.mode,
  }));
}

export async function callState(viewer: Viewer, callId: string) {
  const call = await loadCall(callId);
  const role = participantRole(call, viewer);
  // Each status check is the heartbeat that keeps a live call open.
  if (call.status === "active" || call.status === "ringing") {
    await getSupabase().from("calls").update({ last_seen_at: new Date().toISOString() }).eq("id", callId);
  }
  return {
    callId: call.id, status: call.status, mode: call.mode, role,
    answeredAt: call.answered_at, endedAt: call.ended_at, durationSeconds: call.duration_seconds,
  };
}

export async function answerCall(viewer: Viewer, callId: string) {
  const call = await loadCall(callId);
  if (participantRole(call, viewer) !== "callee") throw new Error("Only the person being called can answer.");
  if (call.status !== "ringing") throw new Error("This call is no longer ringing.");
  if (isRingExpired(call.created_at)) {
    await getSupabase().from("calls").update({ status: "cancelled", ended_at: new Date().toISOString() }).eq("id", callId);
    throw new Error("This call has timed out.");
  }
  const now = new Date().toISOString();
  const { error } = await getSupabase().from("calls").update({ status: "active", answered_at: now, last_seen_at: now }).eq("id", callId);
  if (error) throw new Error(`answerCall failed: ${error.message}`);
  return { callId, status: "active" };
}

export async function rejectCall(viewer: Viewer, callId: string) {
  const call = await loadCall(callId);
  if (participantRole(call, viewer) !== "callee") throw new Error("Only the person being called can decline.");
  if (call.status !== "ringing") return { callId, status: call.status };
  const { error } = await getSupabase().from("calls").update({ status: "rejected", ended_at: new Date().toISOString() }).eq("id", callId);
  if (error) throw new Error(`rejectCall failed: ${error.message}`);
  return { callId, status: "rejected" };
}

/** Either person can end it. Ending a call that has already ended does nothing. */
export async function endCall(viewer: Viewer, callId: string) {
  const call = await loadCall(callId);
  const role = participantRole(call, viewer);
  const now = new Date().toISOString();
  if (call.status === "ringing") {
    const status = role === "caller" ? "cancelled" : "rejected";
    const { error } = await getSupabase().from("calls").update({ status, ended_at: now }).eq("id", callId);
    if (error) throw new Error(`endCall failed: ${error.message}`);
    return { callId, status };
  }
  if (call.status === "active") {
    const duration = durationSeconds(call.answered_at || call.created_at, now);
    const { error } = await getSupabase().from("calls").update({ status: "ended", ended_at: now, duration_seconds: duration }).eq("id", callId);
    if (error) throw new Error(`endCall failed: ${error.message}`);
    return { callId, status: "ended", durationSeconds: duration };
  }
  return { callId, status: call.status };
}

/** Connection details (offer, answer, candidates) passed to the other person. The server only relays them. */
export async function sendSignal(viewer: Viewer, callId: string, kind: unknown, payload: unknown) {
  const problem = validateSignal(kind, payload);
  if (problem) throw new Error(problem);
  const call = await loadCall(callId);
  const role = participantRole(call, viewer);
  if (call.status !== "ringing" && call.status !== "active") throw new Error("This call has ended.");
  const to = role === "caller"
    ? { kind: call.callee_kind, id: call.callee_id }
    : { kind: call.caller_kind, id: call.caller_id };
  const { error } = await getSupabase().from("call_signals").insert({
    call_id: callId, from_kind: viewer.kind, from_id: viewer.id, to_kind: to.kind, to_id: to.id,
    kind: kind as string, payload: payload as Record<string, unknown>,
  });
  if (error) throw new Error(`sendSignal failed: ${error.message}`);
  return { success: true };
}

/** Signals addressed to this person that they have not yet received, oldest first. */
export async function fetchSignals(viewer: Viewer, callId: string, after: number) {
  const call = await loadCall(callId);
  participantRole(call, viewer);
  const { data, error } = await getSupabase().from("call_signals")
    .select("id, from_kind, from_id, to_kind, to_id, kind, payload")
    .eq("call_id", callId).eq("to_kind", viewer.kind).eq("to_id", viewer.id)
    .gt("id", after).order("id", { ascending: true }).limit(100);
  if (error) throw new Error(`fetchSignals failed: ${error.message}`);
  return ((data || []) as unknown as SignalRow[]).map((s) => ({ id: s.id, kind: s.kind, payload: s.payload }));
}

export { studentViewer };
