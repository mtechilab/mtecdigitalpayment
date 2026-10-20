import { getSupabase } from "../db/supabaseClient.js";

/** Every receipt, newest first, with the student's name, for administrators and finance officers. */
export async function listAllReceipts(limit: number = 200) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("receipts")
    .select("receipt_number, student_row_id, amount, method, date, received_by, previous_balance, new_balance")
    .order("date", { ascending: false }).limit(limit);
  if (error) throw new Error(`listAllReceipts failed: ${error.message}`);
  const rows = (data || []) as unknown as {
    receipt_number: string; student_row_id: string; amount: number; method: string; date: string;
    received_by: string; previous_balance: number; new_balance: number;
  }[];
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.student_row_id))];
  const { data: students } = await supabase.from("students").select("id, student_id, full_name, programme, phone").in("id", ids);
  const byId = new Map(((students || []) as unknown as { id: string; student_id: string; full_name: string; programme: string; phone: string }[])
    .map((s) => [s.id, s]));
  return rows.map((r) => {
    const st = byId.get(r.student_row_id);
    return {
      receipt_number: r.receipt_number, amount: r.amount, method: r.method, date: r.date, received_by: r.received_by,
      previous_balance: r.previous_balance, new_balance: r.new_balance,
      student_id: st?.student_id || "", student_name: st?.full_name || "", programme: st?.programme || "", student_phone: st?.phone || "",
    };
  });
}

/** The student a receipt belongs to, so its PDF can be produced for an administrator or finance officer. */
export async function receiptOwner(receiptNumber: string): Promise<string> {
  const { data, error } = await getSupabase().from("receipts").select("student_row_id")
    .eq("receipt_number", receiptNumber).maybeSingle();
  if (error) throw new Error(`receiptOwner failed: ${error.message}`);
  const row = data as unknown as { student_row_id: string } | null;
  if (!row) throw new Error("Receipt not found.");
  return row.student_row_id;
}
