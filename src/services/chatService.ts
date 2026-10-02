import { getSupabase } from "../db/supabaseClient.js";

export async function getThread(studentRowId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("sender_type, sender_name, message, created_at")
    .eq("student_row_id", studentRowId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getThread failed: ${error.message}`);
  return data || [];
}

export async function sendMessage(studentRowId: string, senderType: "student" | "staff", senderName: string, message: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("chat_messages")
    .insert({ student_row_id: studentRowId, sender_type: senderType, sender_name: senderName, message });
  if (error) throw new Error(`sendMessage failed: ${error.message}`);
  return { success: true };
}

/** Threads where the most recent message came from the student — i.e.
 *  staff hasn't replied yet. Computed in JS rather than a fancier SQL
 *  DISTINCT ON, since chat volume here doesn't need it. */
export async function getThreadsNeedingReply() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("student_row_id, sender_type, sender_name, message, created_at, students(student_id, full_name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getThreadsNeedingReply failed: ${error.message}`);

  const latestByStudent = new Map<string, any>();
  for (const row of data || []) {
    if (!latestByStudent.has(row.student_row_id)) latestByStudent.set(row.student_row_id, row);
  }
  return Array.from(latestByStudent.values()).filter((row) => row.sender_type === "student");
}
