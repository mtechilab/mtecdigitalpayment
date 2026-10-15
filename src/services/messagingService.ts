import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { validateText, validateVoice, unreadCount } from "./messagingPolicy.js";
import { canTeach, isAdministratorRole } from "./staffValidation.js";

export type Viewer =
  | { kind: "student"; id: string; name: string; programme: string }
  | { kind: "staff"; id: string; name: string; role: string };

interface ConversationRow {
  id: string; kind: string; title: string; programme: string | null; class_id: string | null;
  created_by_staff_id: string | null; last_message_at: string | null;
}

const SIGNED_SECONDS = 300;

async function loadConversation(id: string): Promise<ConversationRow> {
  const { data, error } = await getSupabase().from("conversations").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`loadConversation failed: ${error.message}`);
  if (!data) throw new Error("That conversation was not found.");
  return data as unknown as ConversationRow;
}

export async function studentViewer(studentRowId: string): Promise<Viewer> {
  const { data, error } = await getSupabase().from("students").select("id, full_name, programme").eq("id", studentRowId).maybeSingle();
  if (error) throw new Error(`studentViewer failed: ${error.message}`);
  if (!data) throw new Error("Student not found.");
  return { kind: "student", id: data.id as string, name: data.full_name as string, programme: data.programme as string };
}

/** Access is decided at the moment of reading or sending. Group access comes from programme and class records,
 *  so a student who joins a programme or class gets the group without any membership step. */
async function canAccess(conv: ConversationRow, viewer: Viewer): Promise<boolean> {
  const supabase = getSupabase();
  if (conv.kind === "direct") {
    const { data } = await supabase.from("conversation_members").select("member_id")
      .eq("conversation_id", conv.id).eq("member_kind", viewer.kind).eq("member_id", viewer.id).maybeSingle();
    return !!data;
  }
  if (conv.kind === "programme") {
    if (viewer.kind === "staff") return canTeach(viewer.role);
    return viewer.programme.toLowerCase() === (conv.programme || "").toLowerCase();
  }
  if (conv.kind === "class") {
    if (viewer.kind === "student") {
      const { data } = await supabase.from("classes").select("id").eq("id", conv.class_id as string).contains("student_ids", [viewer.id]).maybeSingle();
      return !!data;
    }
    if (isAdministratorRole(viewer.role)) return true;
    if (!canTeach(viewer.role)) return false;
    if (conv.created_by_staff_id === viewer.id) return true;
    const { data } = await supabase.from("classes").select("id").eq("id", conv.class_id as string).ilike("instructor_name", viewer.name).maybeSingle();
    return !!data;
  }
  return false;
}

async function requireAccess(conversationId: string, viewer: Viewer): Promise<ConversationRow> {
  const conv = await loadConversation(conversationId);
  if (!(await canAccess(conv, viewer))) throw new Error("That conversation was not found.");
  return conv;
}

/** Conversations the viewer can open, with unread counts. */
export async function listConversations(viewer: Viewer) {
  const supabase = getSupabase();
  const ids = new Set<string>();
  const add = (rows: { id?: unknown; conversation_id?: unknown }[] | null) => {
    for (const r of rows || []) ids.add((r.id ?? r.conversation_id) as string);
  };

  if (viewer.kind === "student") {
    add((await supabase.from("conversation_members").select("conversation_id").eq("member_kind", "student").eq("member_id", viewer.id)).data);
    add((await supabase.from("conversations").select("id").eq("kind", "programme").ilike("programme", viewer.programme)).data);
    const { data: myClasses } = await supabase.from("classes").select("id").contains("student_ids", [viewer.id]);
    const classIds = ((myClasses || []) as Array<Record<string, any>>).map((c) => c.id as string);
    if (classIds.length > 0) add((await supabase.from("conversations").select("id").eq("kind", "class").in("class_id", classIds)).data);
  } else {
    add((await supabase.from("conversation_members").select("conversation_id").eq("member_kind", "staff").eq("member_id", viewer.id)).data);
    if (canTeach(viewer.role)) {
      add((await supabase.from("conversations").select("id").eq("kind", "programme")).data);
      const classQuery = supabase.from("conversations").select("id, class_id, created_by_staff_id").eq("kind", "class");
      const { data: classRows } = await classQuery;
      if (isAdministratorRole(viewer.role)) add(classRows);
      else {
        const { data: instructed } = await supabase.from("classes").select("id").ilike("instructor_name", viewer.name);
        const instructedIds = new Set(((instructed || []) as Array<Record<string, any>>).map((c) => c.id as string));
        for (const r of (classRows || []) as Array<Record<string, any>>) {
          if (r.created_by_staff_id === viewer.id || instructedIds.has(r.class_id as string)) ids.add(r.id as string);
        }
      }
    }
  }

  if (ids.size === 0) return [];
  const { data: convs, error } = await supabase.from("conversations")
    .select("id, kind, title, programme, last_message_at").in("id", [...ids]).order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`listConversations failed: ${error.message}`);
  const list = (convs || []) as unknown as { id: string; kind: string; title: string; programme: string | null; last_message_at: string | null }[];

  const { data: reads } = await supabase.from("conversation_reads").select("conversation_id, last_read_at")
    .eq("reader_kind", viewer.kind).eq("reader_id", viewer.id);
  const readAt = new Map(((reads || []) as Array<Record<string, any>>).map((r) => [r.conversation_id as string, r.last_read_at as string]));

  const result = [];
  for (const c of list) {
    const since = readAt.get(c.id) || "1970-01-01T00:00:00Z";
    const { data: fresh } = await supabase.from("messages").select("sender_kind, sender_id")
      .eq("conversation_id", c.id).gt("created_at", since).limit(200);
    const unread = unreadCount(((fresh || []) as Array<Record<string, any>>).map((m) => ({ senderKind: m.sender_kind as string, senderId: m.sender_id as string })), viewer.kind, viewer.id);
    result.push({ id: c.id, kind: c.kind, title: c.title, programme: c.programme, lastMessageAt: c.last_message_at, unread });
  }
  return result;
}

/** Messages after a time, oldest first, with a short-lived link for each voice note. */
export async function listMessages(viewer: Viewer, conversationId: string, after?: string) {
  await requireAccess(conversationId, viewer);
  const supabase = getSupabase();
  let q = supabase.from("messages").select("id, sender_kind, sender_id, sender_name, kind, body, voice_path, voice_seconds, created_at")
    .eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(100);
  if (after) q = q.gt("created_at", after);
  const { data, error } = await q;
  if (error) throw new Error(`listMessages failed: ${error.message}`);
  const out = [];
  for (const m of data || []) {
    let voiceUrl: string | null = null;
    if (m.kind === "voice" && m.voice_path) {
      const { data: signed } = await supabase.storage.from("voice-notes").createSignedUrl(m.voice_path as string, SIGNED_SECONDS);
      voiceUrl = signed?.signedUrl || null;
    }
    out.push({
      id: m.id, senderKind: m.sender_kind, senderName: m.sender_name, mine: m.sender_kind === viewer.kind && m.sender_id === viewer.id,
      kind: m.kind, body: m.body, voiceUrl, voiceSeconds: m.voice_seconds, createdAt: m.created_at,
    });
  }
  return out;
}

export async function sendMessage(viewer: Viewer, conversationId: string, input: { body?: string; voice?: { base64: string; contentType: string; seconds: number } }) {
  const conv = await requireAccess(conversationId, viewer);
  const supabase = getSupabase();
  const now = new Date().toISOString();
  let row: Record<string, unknown>;

  if (input.voice) {
    const problem = validateVoice(input.voice.contentType, input.voice.base64, input.voice.seconds);
    if (problem) throw new Error(problem);
    const ext = input.voice.contentType.includes("ogg") ? "ogg" : input.voice.contentType.includes("webm") ? "webm" : input.voice.contentType.includes("3gpp") ? "3gp" : "m4a";
    const path = `${conversationId}/${Date.now()}-${viewer.id}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("voice-notes")
      .upload(path, Buffer.from(input.voice.base64, "base64"), { contentType: input.voice.contentType, upsert: false });
    if (uploadError) throw new Error(`Could not store the voice note: ${uploadError.message}`);
    row = { conversation_id: conversationId, sender_kind: viewer.kind, sender_id: viewer.id, sender_name: viewer.name, kind: "voice", voice_path: path, voice_seconds: input.voice.seconds };
  } else {
    const problem = validateText(input.body || "");
    if (problem) throw new Error(problem);
    row = { conversation_id: conversationId, sender_kind: viewer.kind, sender_id: viewer.id, sender_name: viewer.name, kind: "text", body: (input.body || "").trim() };
  }

  const { data, error } = await supabase.from("messages").insert(row).select("id, created_at").single();
  if (error) throw new Error(`sendMessage failed: ${error.message}`);
  await supabase.from("conversations").update({ last_message_at: now }).eq("id", conv.id);
  await markRead(viewer, conversationId);
  return { id: data.id, createdAt: data.created_at };
}

export async function markRead(viewer: Viewer, conversationId: string) {
  await requireAccess(conversationId, viewer);
  const { error } = await getSupabase().from("conversation_reads").upsert({
    conversation_id: conversationId, reader_kind: viewer.kind, reader_id: viewer.id, last_read_at: new Date().toISOString(),
  }, { onConflict: "conversation_id,reader_kind,reader_id" });
  if (error) throw new Error(`markRead failed: ${error.message}`);
  return { success: true };
}

/** The programme's group: one per programme. Administrators only. */
export async function createProgrammeGroup(actor: { name: string; role: string }, programme: string) {
  if (!isAdministratorRole(actor.role)) throw new Error("Only administrators create programme groups.");
  const name = programme.trim();
  if (name.length < 2) throw new Error("Choose the programme.");
  const supabase = getSupabase();
  const { data: existing } = await supabase.from("conversations").select("id").eq("kind", "programme").ilike("programme", name).maybeSingle();
  if (existing) return { id: existing.id, created: false };
  const { data, error } = await supabase.from("conversations").insert({
    kind: "programme", title: `${name} (all students)`, programme: name, created_by_name: actor.name,
  }).select("id").single();
  if (error) throw new Error(`createProgrammeGroup failed: ${error.message}`);
  await recordAudit({ actor: actor.name, action: "message_group.create", entityType: "conversation", entityId: data.id as string, detail: { kind: "programme", programme: name } });
  return { id: data.id, created: true };
}

/** A class's group: its instructor or an administrator may create it. */
export async function createClassGroup(actor: { id: string; name: string; role: string }, classId: string) {
  if (!canTeach(actor.role)) throw new Error("Only lecturers and administrators create class groups.");
  const supabase = getSupabase();
  const { data: cls, error } = await supabase.from("classes").select("id, instructor_name, course_id").eq("id", classId).maybeSingle();
  if (error) throw new Error(`createClassGroup failed: ${error.message}`);
  if (!cls) throw new Error("That class was not found.");
  const isInstructor = (cls.instructor_name as string || "").toLowerCase() === actor.name.toLowerCase();
  if (!isAdministratorRole(actor.role) && !isInstructor) throw new Error("You can only create the group for a class you teach.");

  const { data: existing } = await supabase.from("conversations").select("id").eq("kind", "class").eq("class_id", classId).maybeSingle();
  if (existing) return { id: existing.id, created: false };
  const { data: course } = await supabase.from("courses").select("code, name").eq("id", cls.course_id as string).maybeSingle();
  const title = course ? `${course.code} ${course.name} (class)` : "Class group";
  const { data, error: insertError } = await supabase.from("conversations").insert({
    kind: "class", title, class_id: classId, created_by_staff_id: actor.id, created_by_name: actor.name,
  }).select("id").single();
  if (insertError) throw new Error(`createClassGroup (insert) failed: ${insertError.message}`);
  return { id: data.id, created: true };
}

/** A direct chat between a teaching staff member and one student. Reuses the chat if it exists. */
export async function startDirectChat(staff: { id: string; name: string; role: string }, studentRowId: string) {
  if (!canTeach(staff.role)) throw new Error("Only lecturers and administrators start direct chats.");
  const supabase = getSupabase();
  const student = await studentViewer(studentRowId);
  const { data: mine } = await supabase.from("conversation_members").select("conversation_id")
    .eq("member_kind", "staff").eq("member_id", staff.id);
  const candidates = ((mine || []) as Array<Record<string, any>>).map((m) => m.conversation_id as string);
  if (candidates.length > 0) {
    const { data: shared } = await supabase.from("conversation_members").select("conversation_id")
      .eq("member_kind", "student").eq("member_id", student.id).in("conversation_id", candidates).maybeSingle();
    if (shared) return { id: shared.conversation_id, created: false };
  }
  const { data, error } = await supabase.from("conversations").insert({
    kind: "direct", title: student.name, created_by_staff_id: staff.id, created_by_name: staff.name,
  }).select("id").single();
  if (error) throw new Error(`startDirectChat failed: ${error.message}`);
  const { error: memberError } = await supabase.from("conversation_members").insert([
    { conversation_id: data.id, member_kind: "student", member_id: student.id, member_name: student.name },
    { conversation_id: data.id, member_kind: "staff", member_id: staff.id, member_name: staff.name },
  ]);
  if (memberError) throw new Error(`startDirectChat (members) failed: ${memberError.message}`);
  return { id: data.id, created: true };
}
