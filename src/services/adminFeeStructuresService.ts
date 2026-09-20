import { getSupabase } from "../db/supabaseClient.js";

export async function listFeeStructures() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("fee_structures")
    .select("programme, registration_fee, tuition_per_semester")
    .order("programme", { ascending: true });
  if (error) throw new Error(`listFeeStructures failed: ${error.message}`);
  return data;
}
