import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { validateReason } from "./adminDataPolicy.js";

/** A continuing student's balance, entered as the total fee and the amount already paid. The balance is what is left. */
export async function recordOpeningBalance(admin: string, input: {
  studentId: unknown; totalFee: unknown; amountPaid: unknown; reason: unknown;
}) {
  const reasonProblem = validateReason(input.reason);
  if (reasonProblem) throw new Error(reasonProblem);
  if (typeof input.studentId !== "string" || !input.studentId.trim()) throw new Error("Enter the student ID.");
  const total = Number(input.totalFee);
  const paid = Number(input.amountPaid);
  if (!Number.isFinite(total) || total <= 0 || total > 100000) throw new Error("The total fee must be more than 0, and at most 100000.");
  if (!Number.isFinite(paid) || paid < 0 || paid > total) throw new Error("The amount paid must be 0 or more, and no more than the total fee.");

  const supabase = getSupabase();
  const { data: student } = await supabase.from("students").select("id, student_id, full_name, programme, status")
    .eq("student_id", input.studentId.trim()).maybeSingle();
  const s = student as unknown as { id: string; student_id: string; full_name: string; programme: string; status: string } | null;
  if (!s) throw new Error("No student has that student ID.");
  if (s.status !== "active") throw new Error("This student is not active. Reactivate them first.");

  const { data: existing } = await supabase.from("payment_plans").select("id").eq("student_row_id", s.id).limit(1).maybeSingle();
  if (existing) throw new Error("This student already has a payment plan, so an opening balance cannot be added. Adjust the existing plan instead.");

  const { data: programme } = await supabase.from("programmes").select("id").ilike("name", s.programme).maybeSingle();
  const programmeId = (programme as unknown as { id: string } | null)?.id;
  if (!programmeId) throw new Error("The student's programme was not found. Check the programme first.");

  const today = new Date();
  const endDate = new Date(today);
  endDate.setMonth(endDate.getMonth() + 6);
  const { data: plan, error: planError } = await supabase.from("payment_plans").insert({
    student_row_id: s.id, programme_id: programmeId, label: "Opening balance (continuing student)", frequency: "semester",
    period_amount: total, total_amount: total, plan_start_date: today.toISOString().slice(0, 10),
    plan_end_date: endDate.toISOString().slice(0, 10), status: "active",
  }).select("id").single();
  if (planError || !plan) throw new Error(`The payment plan could not be created: ${planError?.message || "unknown"}`);
  const planId = (plan as unknown as { id: string }).id;

  const { error: periodError } = await supabase.from("payment_periods").insert({
    payment_plan_id: planId, period_label: "Opening balance", period_index: 1,
    due_date: today.toISOString().slice(0, 10), amount_due: total, amount_paid: paid, status: "due",
  });
  if (periodError) throw new Error(`The balance could not be recorded: ${periodError.message}`);

  await recordAudit({ actor: admin, action: "student.opening_balance", entityType: "student", entityId: s.id,
    detail: { totalFee: total, amountPaid: paid, balance: total - paid, reason: String(input.reason).trim() } });
  return { success: true, studentId: s.student_id, fullName: s.full_name, totalFee: total, amountPaid: paid, balance: total - paid };
}
