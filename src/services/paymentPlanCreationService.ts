import { getSupabase } from "../db/supabaseClient.js";

const FREQUENCY_MONTHS: Record<string, number> = {
  monthly: 1,
  weekly: 0, // handled separately — periods are date-based, not month-based
  daily: 0,
  semester: 6,
};

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export interface CreatePlanParams {
  studentRowId: string;
  label: string;
  frequency: "daily" | "weekly" | "monthly" | "semester";
  totalAmount: number;
  periodCount: number;
  startDate: string; // ISO date
}

export type CreatePlanResult =
  | { outcome: "success"; planId: string }
  | { outcome: "student_not_found" }
  | { outcome: "programme_not_found"; programme: string }
  | { outcome: "plan_already_exists" };

/** Creates a payment plan plus its full schedule of periods, evenly
 *  dividing totalAmount across periodCount periods. Looks up the
 *  programme's UUID by matching the student's programme name — payment_plans
 *  references programmes.id, but students.programme is free text, so this
 *  is the join point between the two. */
export async function createPaymentPlan(params: CreatePlanParams): Promise<CreatePlanResult> {
  const supabase = getSupabase();

  const { data: student, error: studentErr } = await supabase
    .from("students").select("id, programme").eq("id", params.studentRowId).maybeSingle();
  if (studentErr) throw new Error(`createPaymentPlan student lookup failed: ${studentErr.message}`);
  if (!student) return { outcome: "student_not_found" };

  const { data: existing } = await supabase
    .from("payment_plans").select("id").eq("student_row_id", params.studentRowId).eq("status", "active").maybeSingle();
  if (existing) return { outcome: "plan_already_exists" };

  const { data: programme, error: progErr } = await supabase
    .from("programmes").select("id").eq("name", student.programme).maybeSingle();
  if (progErr) throw new Error(`createPaymentPlan programme lookup failed: ${progErr.message}`);
  if (!programme) return { outcome: "programme_not_found", programme: student.programme };

  const startDate = new Date(params.startDate);
  const monthsPerPeriod = FREQUENCY_MONTHS[params.frequency] || 1;
  const endDate = params.frequency === "semester" || params.frequency === "monthly"
    ? addMonths(startDate, monthsPerPeriod * params.periodCount)
    : new Date(startDate.getTime() + params.periodCount * (params.frequency === "weekly" ? 7 : 1) * 86400000);

  const { data: plan, error: planErr } = await supabase
    .from("payment_plans")
    .insert({
      student_row_id: params.studentRowId,
      programme_id: programme.id,
      label: params.label,
      frequency: params.frequency,
      period_amount: Math.round((params.totalAmount / params.periodCount) * 100) / 100,
      total_amount: params.totalAmount,
      plan_start_date: params.startDate,
      plan_end_date: endDate.toISOString().slice(0, 10),
      status: "active",
    })
    .select("id")
    .single();
  if (planErr || !plan) throw new Error(`createPaymentPlan insert failed: ${planErr?.message}`);

  const periodAmount = Math.round((params.totalAmount / params.periodCount) * 100) / 100;
  const periods = [];
  for (let i = 0; i < params.periodCount; i++) {
    let dueDate: Date;
    let label: string;
    if (params.frequency === "weekly") {
      dueDate = new Date(startDate.getTime() + i * 7 * 86400000);
      label = `Week ${i + 1}`;
    } else if (params.frequency === "daily") {
      dueDate = new Date(startDate.getTime() + i * 86400000);
      label = dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } else {
      dueDate = addMonths(startDate, i * monthsPerPeriod);
      label = params.frequency === "semester" ? `${params.label} — Period ${i + 1}` : monthLabel(dueDate);
    }
    periods.push({
      payment_plan_id: plan.id,
      period_label: label,
      period_index: i + 1,
      due_date: dueDate.toISOString().slice(0, 10),
      amount_due: periodAmount,
      amount_paid: 0,
      status: i === 0 ? "due" : "upcoming",
    });
  }

  const { error: periodsErr } = await supabase.from("payment_periods").insert(periods);
  if (periodsErr) throw new Error(`createPaymentPlan periods insert failed: ${periodsErr.message}`);

  return { outcome: "success", planId: plan.id };
}
