import { getSupabase } from "../db/supabaseClient.js";

/** Full transaction history, most recent first, capped at 100 — this is a
 *  browsing view, not an export; add real pagination (cursor or offset)
 *  before this needs to show more than that in practice. */
export async function listTransactions(status?: string, method?: string) {
  const supabase = getSupabase();
  let query = supabase
    .from("payment_submissions")
    .select("id, mtec_reference, amount, method, status, provider_reference, created_at, students(student_id, full_name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  if (method) query = query.eq("method", method);
  const { data, error } = await query;
  if (error) throw new Error(`listTransactions failed: ${error.message}`);
  return data;
}
