import { getSupabase } from "../db/supabaseClient.js";

export async function listStudents(search?: string) {
  const supabase = getSupabase();
  let query = supabase
    .from("students")
    .select("id, student_id, full_name, programme, level, status")
    .order("created_at", { ascending: false });
  if (search) {
    query = query.or(`full_name.ilike.%${search}%,student_id.ilike.%${search}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`listStudents failed: ${error.message}`);
  return data;
}

/** Read-only detail view: profile + current payment plan summary + enrolled
 *  courses. No edit actions yet — this is the same scope discipline as the
 *  first Applications screen (list + view before list + manage). */
export async function getStudentDetail(studentRowId: string) {
  const supabase = getSupabase();

  const { data: student, error: studentErr } = await supabase
    .from("students")
    .select("student_id, full_name, phone, email, programme, academic_year, level, status")
    .eq("id", studentRowId)
    .maybeSingle();
  if (studentErr) throw new Error(`getStudentDetail lookup failed: ${studentErr.message}`);
  if (!student) return null;

  const { data: plan } = await supabase
    .from("payment_plans")
    .select("id, total_amount, status")
    .eq("student_row_id", studentRowId)
    .eq("status", "active")
    .maybeSingle();

  let amountPaid = 0;
  if (plan) {
    const { data: periods } = await supabase
      .from("payment_periods")
      .select("amount_paid")
      .eq("payment_plan_id", plan.id);
    amountPaid = (periods || []).reduce((sum, p) => sum + Number(p.amount_paid), 0);
  }

  const { data: classesRaw } = await supabase
    .from("classes")
    .select("courses(code, name)")
    .contains("student_ids", [studentRowId]);
  const courses = (classesRaw || [])
    .map((c: any) => c.courses)
    .filter(Boolean)
    .map((c: any) => `${c.code} — ${c.name}`);

  return {
    ...student,
    totalFees: plan ? Number(plan.total_amount) : null,
    amountPaid,
    courses,
  };
}
