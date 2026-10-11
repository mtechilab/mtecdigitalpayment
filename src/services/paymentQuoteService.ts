import { getSupabase } from "../db/supabaseClient.js";
import { quoteAllFrequencies } from "./paymentQuote.js";

/** The student's payment options for their active plan: for each frequency,
 *  the suggested amount and the most they can pay. Based on what is still owed
 *  and how many days remain, so it moves as payments are made. */
export async function getPaymentQuote(studentRowId: string) {
  const supabase = getSupabase();
  const { data: plan, error: planError } = await supabase
    .from("payment_plans")
    .select("id, label, total_amount, plan_end_date")
    .eq("student_row_id", studentRowId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planError) throw new Error(`getPaymentQuote (plan) failed: ${planError.message}`);
  if (!plan) return null;

  const { data: periods, error: periodError } = await supabase
    .from("payment_periods")
    .select("amount_due, amount_paid")
    .eq("payment_plan_id", plan.id);
  if (periodError) throw new Error(`getPaymentQuote (periods) failed: ${periodError.message}`);

  const remaining = (periods || []).reduce((sum, p) => sum + (Number(p.amount_due) - Number(p.amount_paid)), 0);
  const end = new Date(plan.plan_end_date as unknown as string);
  const daysRemaining = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));

  return {
    planLabel: plan.label,
    planEnd: plan.plan_end_date,
    remainingBalance: Math.max(0, Math.round(remaining * 100) / 100),
    options: quoteAllFrequencies(remaining, daysRemaining),
  };
}
