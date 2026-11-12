import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { validateReason } from "./adminDataPolicy.js";

type Loose = { from(t: string): any };
const db = (): Loose => getSupabase() as unknown as Loose;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Changes an active plan's total and, optionally, the amount paid. The total is shared across the periods.
 *  Leaving the amount paid blank keeps the existing allocation, so real receipts are not disturbed. */
export async function adjustPaymentPlan(admin: string, studentRowId: string, input: {
  totalAmount?: unknown; amountPaid?: unknown; reason: unknown;
}) {
  const reasonProblem = validateReason(input.reason);
  if (reasonProblem) throw new Error(reasonProblem);
  const { data: plan, error } = await db().from("payment_plans").select("id, total_amount, status")
    .eq("student_row_id", studentRowId).eq("status", "active").maybeSingle();
  if (error) throw new Error(`Could not load the plan: ${error.message}`);
  if (!plan) throw new Error("This student has no active payment plan to change.");
  const { data: periods, error: pErr } = await db().from("payment_periods").select("period_index, amount_due, amount_paid")
    .eq("payment_plan_id", plan.id).order("period_index", { ascending: true });
  if (pErr) throw new Error(`Could not load the periods: ${pErr.message}`);
  const list = (periods || []) as { period_index: number; amount_due: number; amount_paid: number }[];
  if (list.length === 0) throw new Error("This plan has no periods to change.");

  const oldTotal = Number(plan.total_amount) || list.reduce((a, p) => a + Number(p.amount_due), 0);
  const oldPaid = round2(list.reduce((a, p) => a + Number(p.amount_paid || 0), 0));
  const newTotal = input.totalAmount === undefined || input.totalAmount === "" ? oldTotal : round2(Number(input.totalAmount));
  if (!Number.isFinite(newTotal) || newTotal <= 0 || newTotal > 100000) throw new Error("The total fee must be more than 0, and at most 100000.");
  if (newTotal < oldPaid) throw new Error(`The total cannot be less than the amount already paid (NLe ${oldPaid.toFixed(2)}). Reverse those payments first.`);
  const newPaid = input.amountPaid === undefined || input.amountPaid === "" ? oldPaid : round2(Number(input.amountPaid));
  if (!Number.isFinite(newPaid) || newPaid < 0 || newPaid > newTotal) throw new Error("The amount paid must be 0 or more, and no more than the total fee.");

  // Share the total across the periods; the last period takes the rounding difference.
  const n = list.length;
  const base = round2(newTotal / n);
  const dues = list.map((_, i) => (i === n - 1 ? round2(newTotal - base * (n - 1)) : base));
  // Allocate the paid amount from the earliest period, only when the admin changes it.
  const paidChanged = newPaid !== oldPaid;
  let remaining = newPaid;
  for (let i = 0; i < n; i++) {
    const period = list[i];
    const due = dues[i];
    let paid = Number(period.amount_paid || 0);
    if (paidChanged) { paid = Math.min(remaining, due); remaining = round2(remaining - paid); }
    const { error: uErr } = await db().from("payment_periods").update({ amount_due: due, amount_paid: round2(paid) })
      .eq("payment_plan_id", plan.id).eq("period_index", period.period_index);
    if (uErr) throw new Error(`The periods could not be updated: ${uErr.message}`);
  }
  const { error: planErr } = await db().from("payment_plans").update({ total_amount: newTotal, period_amount: base }).eq("id", plan.id);
  if (planErr) throw new Error(`The plan could not be updated: ${planErr.message}`);

  await recordAudit({ actor: admin, action: "student.payment_plan_adjust", entityType: "student", entityId: studentRowId, detail: {
    oldTotal, newTotal, oldPaid, newPaid, reason: String(input.reason).trim(),
  } });
  return { success: true, totalAmount: newTotal, amountPaid: newPaid, balance: round2(newTotal - newPaid) };
}
