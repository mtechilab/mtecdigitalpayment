import { validateChatFile } from "./chatFilePolicy.js";
import { randomBytes } from "crypto";
import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { validateText, validateVoice, unreadCount, callLinkUrl, CallMode } from "./messagingPolicy.js";
import { isReadBy, previewOf, isTypingNow, ReactionKey } from "./chatPolicy.js";
import { validateGroupName, validateMemberList, groupHasRoom, MemberRef } from "./groupPolicy.js";
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
  if (conv.kind === "direct" || conv.kind === "custom") {
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

  // A direct chat is titled with the other person's name, from each viewer's side.
  const directIds = list.filter((c) => c.kind === "direct").map((c) => c.id);
  const directTitle = new Map<string, string>();
  if (directIds.length > 0) {
    const { data: members } = await supabase.from("conversation_members")
      .select("conversation_id, member_kind, member_id, member_name").in("conversation_id", directIds);
    for (const m of (members || []) as Array<Record<string, any>>) {
      if (m.member_kind === viewer.kind && m.member_id === viewer.id) continue;
      directTitle.set(m.conversation_id as string, m.member_name as string);
    }
  }

  const result = [];
  for (const c of list) {
    const since = readAt.get(c.id) || "1970-01-01T00:00:00Z";
    const { data: fresh } = await supabase.from("messages").select("sender_kind, sender_id")
      .eq("conversation_id", c.id).gt("created_at", since).limit(200);
    const unread = unreadCount(((fresh || []) as Array<Record<string, any>>).map((m) => ({ senderKind: m.sender_kind as string, senderId: m.sender_id as string })), viewer.kind, viewer.id);
    result.push({ id: c.id, kind: c.kind, title: directTitle.get(c.id) ?? c.title, programme: c.programme, lastMessageAt: c.last_message_at, unread });
  }
  return result;
}

/** Messages after a time, oldest first, with a short-lived link for each voice note. */
export async function listMessages(viewer: Viewer, conversationId: string, after?: string) {
  await requireAccess(conversationId, viewer);
  const supabase = getSupabase();
  let q = supabase.from("messages").select("id, sender_kind, sender_id, sender_name, kind, body, voice_path, voice_seconds, file_path, file_name, file_size, reply_to, deleted_for_everyone, created_at")
    .eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(100);
  if (after) q = q.gt("created_at", after);
  const { data, error } = await q;
  if (error) throw new Error(`listMessages failed: ${error.message}`);
  const rows = (data || []) as unknown as {
    id: string; sender_kind: string; sender_id: string; sender_name: string; kind: string; body: string | null;
    voice_path: string | null; voice_seconds: number | null; file_path: string | null; file_name: string | null;
    file_size: number | null; reply_to: string | null; deleted_for_everyone: boolean; created_at: string;
  }[];
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  // Messages this viewer deleted for themselves stay hidden for them only.
  const { data: hiddenRows } = await supabase.from("message_hidden").select("message_id")
    .eq("viewer_kind", viewer.kind).eq("viewer_id", viewer.id).in("message_id", ids);
  const hidden = new Set(((hiddenRows || []) as unknown as { message_id: string }[]).map((h) => h.message_id));

  // The message each reply quotes.
  const replyIds = [...new Set(rows.map((r) => r.reply_to).filter((x): x is string => !!x))];
  const quoted = new Map<string, { id: string; senderName: string; preview: string }>();
  if (replyIds.length > 0) {
    const { data: qs } = await supabase.from("messages").select("id, sender_name, kind, body, deleted_for_everyone").in("id", replyIds);
    for (const m of (qs || []) as unknown as { id: string; sender_name: string; kind: string; body: string | null; deleted_for_everyone: boolean }[]) {
      quoted.set(m.id, { id: m.id, senderName: m.sender_name, preview: previewOf(m.body, m.kind, m.deleted_for_everyone) });
    }
  }

  // Reaction counts, and this viewer's own reaction.
  const { data: reactionRows } = await supabase.from("message_reactions").select("message_id, reactor_kind, reactor_id, reaction").in("message_id", ids);
  const counts = new Map<string, Record<string, number>>();
  const mine = new Map<string, string>();
  for (const r of (reactionRows || []) as unknown as { message_id: string; reactor_kind: string; reactor_id: string; reaction: string }[]) {
    const c = counts.get(r.message_id) || {};
    c[r.reaction] = (c[r.reaction] || 0) + 1;
    counts.set(r.message_id, c);
    if (r.reactor_kind === viewer.kind && r.reactor_id === viewer.id) mine.set(r.message_id, r.reaction);
  }

  // Read receipts: everyone's last-read time in this conversation.
  const { data: readRows } = await supabase.from("conversation_reads").select("reader_kind, reader_id, last_read_at").eq("conversation_id", conversationId);
  const readers = (readRows || []) as unknown as { reader_kind: string; reader_id: string; last_read_at: string }[];

  const out = [];
  for (const m of rows) {
    if (hidden.has(m.id)) continue;
    const deleted = m.deleted_for_everyone;
    const mineMsg = m.sender_kind === viewer.kind && m.sender_id === viewer.id;
    let fileUrl: string | null = null;
    let voiceUrl: string | null = null;
    if (!deleted && (m.kind === "image" || m.kind === "file") && m.file_path) {
      const { data: signed } = await supabase.storage.from("chat-files").createSignedUrl(m.file_path, SIGNED_SECONDS);
      fileUrl = signed?.signedUrl || null;
    }
    if (!deleted && m.kind === "voice" && m.voice_path) {
      const { data: signed } = await supabase.storage.from("voice-notes").createSignedUrl(m.voice_path, SIGNED_SECONDS);
      voiceUrl = signed?.signedUrl || null;
    }
    const readBy = mineMsg
      ? readers.filter((r) => !(r.reader_kind === viewer.kind && r.reader_id === viewer.id) && isReadBy(r.last_read_at, m.created_at)).length
      : null;
    out.push({
      id: m.id, senderKind: m.sender_kind, senderName: m.sender_name, mine: mineMsg, kind: m.kind,
      deleted, body: deleted ? null : m.body, voiceUrl, voiceSeconds: deleted ? null : m.voice_seconds,
      fileUrl, fileName: deleted ? null : m.file_name, fileSize: deleted ? null : m.file_size,
      replyTo: m.reply_to ? quoted.get(m.reply_to) || null : null,
      reactions: counts.get(m.id) || {}, myReaction: mine.get(m.id) || null,
      readBy, createdAt: m.created_at,
    });
  }
  return out;
}

export async function sendMessage(viewer: Viewer, conversationId: string, input: { body?: string; voice?: { base64: string; contentType: string; seconds: number }; file?: { base64: string; contentType: string; fileName: string }; replyTo?: string }) {
  const conv = await requireAccess(conversationId, viewer);
  const supabase = getSupabase();
  const now = new Date().toISOString();
  let row: Record<string, unknown>;

  if (input.file) {
    const check = validateChatFile(input.file.contentType, input.file.fileName, input.file.base64);
    if (!check.ok) throw new Error(check.error);
    const path = `${conversationId}/${Date.now()}-${viewer.id}.${check.ext}`;
    const { error: uploadError } = await supabase.storage.from("chat-files")
      .upload(path, Buffer.from(input.file.base64, "base64"), { contentType: input.file.contentType, upsert: false });
    if (uploadError) throw new Error(`Could not store the file: ${uploadError.message}`);
    row = { conversation_id: conversationId, sender_kind: viewer.kind, sender_id: viewer.id, sender_name: viewer.name,
      kind: check.kind, file_path: path, file_name: check.fileName, file_type: input.file.contentType, file_size: check.size };
  } else if (input.voice) {
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

  if (input.replyTo) {
    const { data: target } = await supabase.from("messages").select("id, conversation_id, deleted_for_everyone")
      .eq("id", input.replyTo).maybeSingle();
    if (!target || target.conversation_id !== conversationId || target.deleted_for_everyone) {
      throw new Error("The message you are replying to is not available.");
    }
    row.reply_to = input.replyTo;
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

/** The classes this staff member can open a group for: every class for an administrator,
 *  otherwise the classes they teach. Each row says whether its group already exists. */
export async function listTeachableClasses(staff: { id: string; name: string; role: string }) {
  if (!canTeach(staff.role)) throw new Error("Only lecturers and administrators create class groups.");
  const supabase = getSupabase();
  let query = supabase.from("classes").select("id, instructor_name, course_id, academic_year")
    .order("academic_year", { ascending: false }).limit(200);
  if (!isAdministratorRole(staff.role)) query = query.ilike("instructor_name", staff.name);
  const { data: classes, error } = await query;
  if (error) throw new Error(`listTeachableClasses failed: ${error.message}`);
  const rows = (classes || []) as unknown as { id: string; instructor_name: string; course_id: string; academic_year: string }[];

  const courseIds = [...new Set(rows.map((r) => r.course_id))];
  const courses = new Map<string, { code: string; name: string }>();
  if (courseIds.length > 0) {
    const { data: cs, error: cError } = await supabase.from("courses").select("id, code, name").in("id", courseIds);
    if (cError) throw new Error(`listTeachableClasses (courses) failed: ${cError.message}`);
    for (const c of (cs || []) as unknown as { id: string; code: string; name: string }[]) courses.set(c.id, { code: c.code, name: c.name });
  }

  const { data: groups } = await supabase.from("conversations").select("class_id").eq("kind", "class");
  const withGroup = new Set(((groups || []) as unknown as { class_id: string | null }[]).map((g) => g.class_id));

  return rows.map((r) => {
    const course = courses.get(r.course_id);
    return {
      id: r.id,
      label: `${course?.code || ""} ${course?.name || "Class"}`.trim(),
      academicYear: r.academic_year,
      instructorName: r.instructor_name,
      hasGroup: withGroup.has(r.id),
    };
  });
}

/** Students find other students to chat with. Only name and programme are shown, never contact details. */
export async function listStudentDirectory(viewer: Viewer, query: string) {
  if (viewer.kind !== "student") throw new Error("Only students use the student directory.");
  const term = query.trim().slice(0, 60).replace(/[%_\\]/g, (c) => `\\${c}`);
  let q = getSupabase().from("students").select("id, student_id, full_name, programme")
    .eq("status", "active").neq("id", viewer.id).order("full_name", { ascending: true }).limit(20);
  if (term) q = q.ilike("full_name", `%${term}%`);
  const { data, error } = await q;
  if (error) throw new Error(`listStudentDirectory failed: ${error.message}`);
  return ((data || []) as Array<Record<string, any>>).map((r) => ({
    id: r.id as string, studentId: r.student_id as string, name: r.full_name as string, programme: r.programme as string,
  }));
}

/** A direct chat between two students. Reuses the existing chat between the same two students. */
export async function startStudentChat(viewer: Viewer, otherStudentId: string) {
  if (viewer.kind !== "student") throw new Error("Only students start student chats.");
  if (otherStudentId === viewer.id) throw new Error("Choose another student.");
  const other = await studentViewer(otherStudentId);
  const supabase = getSupabase();
  const { data: mine } = await supabase.from("conversation_members").select("conversation_id")
    .eq("member_kind", "student").eq("member_id", viewer.id);
  const ids = ((mine || []) as { conversation_id: string }[]).map((m) => m.conversation_id);
  if (ids.length > 0) {
    const { data: shared } = await supabase.from("conversation_members").select("conversation_id")
      .eq("member_kind", "student").eq("member_id", other.id).in("conversation_id", ids).limit(1);
    if (shared && shared.length > 0) return { id: shared[0].conversation_id as string, created: false };
  }
  const { data, error } = await supabase.from("conversations").insert({
    kind: "direct", title: other.name, created_by_name: viewer.name,
  }).select("id").single();
  if (error) throw new Error(`startStudentChat failed: ${error.message}`);
  const { error: memberError } = await supabase.from("conversation_members").insert([
    { conversation_id: data.id, member_kind: "student", member_id: viewer.id, member_name: viewer.name },
    { conversation_id: data.id, member_kind: "student", member_id: other.id, member_name: other.name },
  ]);
  if (memberError) throw new Error(`startStudentChat (members) failed: ${memberError.message}`);
  return { id: data.id as string, created: true };
}

/** A web call link for a conversation's members, posted into the chat so everyone in it can join.
 *  The room is a public video meeting; anyone who holds the link can join it. */
export async function createCallLink(viewer: Viewer, conversationId: string, mode: CallMode) {
  await requireAccess(conversationId, viewer);
  const room = `MTeC-${conversationId.slice(0, 8)}-${randomBytes(6).toString("hex")}`;
  const url = callLinkUrl(room, mode);
  const kind = mode === "audio" ? "voice" : "video";
  await sendMessage(viewer, conversationId, { body: `${viewer.name} started a ${kind} call. Join here: ${url}` });
  return { url };
}

async function messageIn(messageId: string) {
  const { data, error } = await getSupabase().from("messages")
    .select("id, conversation_id, sender_kind, sender_id, kind, voice_path, file_path, deleted_for_everyone")
    .eq("id", messageId).maybeSingle();
  if (error) throw new Error(`messageIn failed: ${error.message}`);
  if (!data) throw new Error("That message was not found.");
  return data as unknown as {
    id: string; conversation_id: string; sender_kind: string; sender_id: string; kind: string;
    voice_path: string | null; file_path: string | null; deleted_for_everyone: boolean;
  };
}

/** "me": hidden for this viewer only. "everyone": removed for all, sender only, and the file is deleted. */
export async function deleteMessage(viewer: Viewer, messageId: string, scope: "me" | "everyone") {
  const supabase = getSupabase();
  const msg = await messageIn(messageId);
  await requireAccess(msg.conversation_id, viewer);
  if (scope === "me") {
    const { error } = await supabase.from("message_hidden").upsert(
      { message_id: messageId, viewer_kind: viewer.kind, viewer_id: viewer.id },
      { onConflict: "message_id,viewer_kind,viewer_id" });
    if (error) throw new Error(`deleteMessage failed: ${error.message}`);
    return { success: true };
  }
  if (!(msg.sender_kind === viewer.kind && msg.sender_id === viewer.id)) {
    throw new Error("You can only delete your own messages for everyone.");
  }
  if (msg.deleted_for_everyone) return { success: true };
  if (msg.voice_path) await supabase.storage.from("voice-notes").remove([msg.voice_path]);
  if (msg.file_path) await supabase.storage.from("chat-files").remove([msg.file_path]);
  const { error } = await supabase.from("messages").update({ deleted_for_everyone: true, body: "" }).eq("id", messageId);
  if (error) throw new Error(`deleteMessage (update) failed: ${error.message}`);
  return { success: true };
}

export async function reactToMessage(viewer: Viewer, messageId: string, reaction: ReactionKey) {
  const msg = await messageIn(messageId);
  await requireAccess(msg.conversation_id, viewer);
  if (msg.deleted_for_everyone) throw new Error("You cannot react to a deleted message.");
  const { error } = await getSupabase().from("message_reactions").upsert(
    { message_id: messageId, reactor_kind: viewer.kind, reactor_id: viewer.id, reaction, created_at: new Date().toISOString() },
    { onConflict: "message_id,reactor_kind,reactor_id" });
  if (error) throw new Error(`reactToMessage failed: ${error.message}`);
  return { success: true };
}

export async function removeReaction(viewer: Viewer, messageId: string) {
  const msg = await messageIn(messageId);
  await requireAccess(msg.conversation_id, viewer);
  const { error } = await getSupabase().from("message_reactions").delete()
    .eq("message_id", messageId).eq("reactor_kind", viewer.kind).eq("reactor_id", viewer.id);
  if (error) throw new Error(`removeReaction failed: ${error.message}`);
  return { success: true };
}

/** Called while the viewer is typing; the conversation shows them for a few seconds. */
export async function setTyping(viewer: Viewer, conversationId: string) {
  await requireAccess(conversationId, viewer);
  const { error } = await getSupabase().from("conversation_typing").upsert(
    { conversation_id: conversationId, member_kind: viewer.kind, member_id: viewer.id, member_name: viewer.name, updated_at: new Date().toISOString() },
    { onConflict: "conversation_id,member_kind,member_id" });
  if (error) throw new Error(`setTyping failed: ${error.message}`);
  return { success: true };
}

/** The names of other people typing in this conversation right now. */
export async function listTyping(viewer: Viewer, conversationId: string) {
  await requireAccess(conversationId, viewer);
  const { data, error } = await getSupabase().from("conversation_typing")
    .select("member_kind, member_id, member_name, updated_at").eq("conversation_id", conversationId);
  if (error) throw new Error(`listTyping failed: ${error.message}`);
  const rows = (data || []) as unknown as { member_kind: string; member_id: string; member_name: string; updated_at: string }[];
  return {
    typing: rows
      .filter((r) => isTypingNow(r.updated_at) && !(r.member_kind === viewer.kind && r.member_id === viewer.id))
      .map((r) => r.member_name),
  };
}

interface GroupRow { id: string; kind: string; created_by_kind: string | null; created_by_id: string | null; created_by_student_id: string | null }

async function loadGroup(conversationId: string): Promise<GroupRow> {
  const { data, error } = await getSupabase().from("conversations")
    .select("id, kind, created_by_kind, created_by_id, created_by_student_id").eq("id", conversationId).maybeSingle();
  if (error) throw new Error(`loadGroup failed: ${error.message}`);
  if (!data || (data as { kind: string }).kind !== "custom") throw new Error("That group was not found.");
  return data as unknown as GroupRow;
}

/** Whether this person created the group. Groups made before migration 024 are matched by student id. */
function isCreator(group: GroupRow, who: { kind: string; id: string }): boolean {
  if (group.created_by_kind && group.created_by_id) return group.created_by_kind === who.kind && group.created_by_id === who.id;
  return who.kind === "student" && group.created_by_student_id === who.id;
}

/** The name of an active student or staff member. Anyone else cannot be added. */
async function memberName(ref: MemberRef): Promise<string> {
  const supabase = getSupabase();
  if (ref.kind === "student") {
    const { data, error } = await supabase.from("students").select("id, full_name, status").eq("id", ref.id).maybeSingle();
    if (error) throw new Error(`memberName failed: ${error.message}`);
    const row = data as unknown as { full_name: string; status: string } | null;
    if (!row || row.status !== "active") throw new Error("Some of the people could not be found.");
    return row.full_name;
  }
  const { data, error } = await supabase.from("staff_accounts").select("id, full_name, active").eq("id", ref.id).maybeSingle();
  if (error) throw new Error(`memberName failed: ${error.message}`);
  const row = data as unknown as { full_name: string; active: boolean } | null;
  if (!row || !row.active) throw new Error("Some of the people could not be found.");
  return row.full_name;
}

/** Any registered member creates a group and adds up to 49 others, students or staff. */
export async function createCustomGroup(viewer: Viewer, name: string, members: unknown) {
  const creator: MemberRef = { kind: viewer.kind, id: viewer.id };
  const nameProblem = validateGroupName(name);
  if (nameProblem) throw new Error(nameProblem);
  const listProblem = validateMemberList(members, creator);
  if (listProblem) throw new Error(listProblem);
  const refs = members as MemberRef[];

  const people: { ref: MemberRef; name: string }[] = [];
  for (const ref of refs) people.push({ ref, name: await memberName(ref) });

  const supabase = getSupabase();
  const { data, error } = await supabase.from("conversations").insert({
    kind: "custom", title: name.trim(), created_by_kind: viewer.kind, created_by_id: viewer.id,
    created_by_student_id: viewer.kind === "student" ? viewer.id : null,
    created_by_name: viewer.name,
  }).select("id").single();
  if (error) throw new Error(`createCustomGroup failed: ${error.message}`);
  const conversationId = (data as { id: string }).id;

  const rows = [
    { conversation_id: conversationId, member_kind: viewer.kind, member_id: viewer.id, member_name: viewer.name },
    ...people.map((p) => ({ conversation_id: conversationId, member_kind: p.ref.kind, member_id: p.ref.id, member_name: p.name })),
  ];
  const { error: memberError } = await supabase.from("conversation_members").insert(rows);
  if (memberError) throw new Error(`createCustomGroup (members) failed: ${memberError.message}`);
  return { id: conversationId, created: true };
}

/** The members of a group, students and staff, with the creator marked. Only members can see the list. */
export async function listGroupMembers(viewer: Viewer, conversationId: string) {
  await requireAccess(conversationId, viewer);
  const group = await loadGroup(conversationId);
  const { data, error } = await getSupabase().from("conversation_members")
    .select("member_kind, member_id, member_name").eq("conversation_id", conversationId);
  if (error) throw new Error(`listGroupMembers failed: ${error.message}`);
  const rows = (data || []) as unknown as { member_kind: string; member_id: string; member_name: string }[];
  return {
    viewer: { kind: viewer.kind, id: viewer.id },
    creator: { kind: group.created_by_kind, id: group.created_by_id || group.created_by_student_id },
    members: rows.map((m) => ({
      kind: m.member_kind, id: m.member_id, name: m.member_name, isCreator: isCreator(group, { kind: m.member_kind, id: m.member_id }),
    })),
  };
}

/** Only the creator adds people, and only up to the group limit. */
export async function addGroupMember(viewer: Viewer, conversationId: string, ref: MemberRef) {
  const group = await loadGroup(conversationId);
  if (!isCreator(group, viewer)) throw new Error("Only the group creator can add people.");
  const listProblem = validateMemberList([ref], { kind: viewer.kind, id: viewer.id });
  if (listProblem) throw new Error(listProblem);
  const { data: existing, error: countError } = await getSupabase().from("conversation_members").select("member_id")
    .eq("conversation_id", conversationId);
  if (countError) throw new Error(`addGroupMember failed: ${countError.message}`);
  const current = (existing || []) as unknown as { member_id: string }[];
  if (!groupHasRoom(current.length)) throw new Error("This group is full.");
  const { data: already } = await getSupabase().from("conversation_members").select("member_id")
    .eq("conversation_id", conversationId).eq("member_kind", ref.kind).eq("member_id", ref.id).maybeSingle();
  if (already) throw new Error("That person is already in the group.");
  const name = await memberName(ref);
  const { error } = await getSupabase().from("conversation_members").insert({
    conversation_id: conversationId, member_kind: ref.kind, member_id: ref.id, member_name: name,
  });
  if (error) throw new Error(`addGroupMember failed: ${error.message}`);
  return { success: true };
}

/** The creator removes someone; anyone else can leave. The creator cannot leave yet. */
export async function removeGroupMember(viewer: Viewer, conversationId: string, ref: MemberRef) {
  const group = await loadGroup(conversationId);
  await requireAccess(conversationId, viewer);
  const creator = isCreator(group, viewer);
  const leaving = ref.kind === viewer.kind && ref.id === viewer.id;
  if (leaving && creator) throw new Error("The creator cannot leave the group yet.");
  if (!leaving && !creator) throw new Error("Only the group creator can remove people.");
  if (!leaving && isCreator(group, ref)) throw new Error("The creator cannot be removed.");
  const { error } = await getSupabase().from("conversation_members").delete()
    .eq("conversation_id", conversationId).eq("member_kind", ref.kind).eq("member_id", ref.id);
  if (error) throw new Error(`removeGroupMember failed: ${error.message}`);
  return { success: true };
}

/** Students and staff the viewer can add to a group: active people, excluding the viewer. */
export async function listMemberDirectory(viewer: Viewer, query: string) {
  const term = query.trim().slice(0, 60).replace(/[%_\\]/g, (c) => `\\${c}`);
  const supabase = getSupabase();
  let students = supabase.from("students").select("id, full_name, programme")
    .eq("status", "active").order("full_name", { ascending: true }).limit(20);
  let staff = supabase.from("staff_accounts").select("id, full_name, role")
    .eq("active", true).order("full_name", { ascending: true }).limit(20);
  if (term) {
    students = students.ilike("full_name", `%${term}%`);
    staff = staff.ilike("full_name", `%${term}%`);
  }
  const [s1, s2] = await Promise.all([students, staff]);
  if (s1.error) throw new Error(`listMemberDirectory failed: ${s1.error.message}`);
  if (s2.error) throw new Error(`listMemberDirectory failed: ${s2.error.message}`);
  const studentRows = ((s1.data || []) as unknown as { id: string; full_name: string; programme: string }[])
    .filter((r) => !(viewer.kind === "student" && r.id === viewer.id))
    .map((r) => ({ kind: "student", id: r.id, name: r.full_name, detail: r.programme }));
  const staffRows = ((s2.data || []) as unknown as { id: string; full_name: string; role: string }[])
    .filter((r) => !(viewer.kind === "staff" && r.id === viewer.id))
    .map((r) => ({ kind: "staff", id: r.id, name: r.full_name, detail: r.role }));
  return [...studentRows, ...staffRows];
}
