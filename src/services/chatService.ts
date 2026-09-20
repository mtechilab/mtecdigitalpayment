import { getSupabase } from "../db/supabaseClient.js";

export async function getThread(studentRowId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("sender_type, sender_name, message, created_at")
    .eq("student_row_id", studentRowId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getThread failed: ${error.message}`);
  return data;
}

export async function sendMessage(
  studentRowId: string,
  senderType: "student" | "staff",
  senderName: string,
  message: string
) {
  const supabase = getSupabase();
  const { error } = await supabase.from("chat_messages").insert({
    student_row_id: studentRowId,
    sender_type: senderType,
    sender_name: senderName,
    message,
    read_by_student: senderType === "student",
    read_by_staff: senderType === "staff",
  });
  if (error) throw new Error(`sendMessage failed: ${error.message}`);
}

/** For the admin side: which students have an unread (from staff's
 *  perspective) message waiting, most recent first. Enough to know who
 *  to check on — not a full inbox with previews/counts yet. */
export async function listThreadsNeedingReply() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("student_row_id, message, created_at, students(student_id, full_name)")
    .eq("sender_type", "student")
    .eq("read_by_staff", false)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listThreadsNeedingReply failed: ${error.message}`);
  const rows = (data || []) as unknown as {
    student_row_id: string; message: string; created_at: string;
    students: { student_id: string; full_name: string } | null;
  }[];

  // Collapse to one row per student (their most recent unread message) —
  // otherwise someone with 3 unread messages shows up 3 times.
  const seen = new Set<string>();
  const result: typeof rows = [];
  for (const row of rows) {
    if (seen.has(row.student_row_id)) continue;
    seen.add(row.student_row_id);
    result.push(row);
  }
  return result;
}
