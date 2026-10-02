import bcrypt from "bcryptjs";
import { getSupabase } from "../db/supabaseClient.js";
import { getPendingCashSubmissions, finalizeVerifiedPayment, rejectSubmission } from "./paymentPlanService.js";

/* ==========================================================================
 * Applications — "Register Student" quick action (real pipeline)
 * ==========================================================================
 * Supersedes an earlier direct-registration shortcut that faked its way
 * around the schema's required application_pins -> applications -> students
 * chain. The Android app now has a proper review screen, so this is the
 * real thing: an application already exists (submitted by an applicant
 * against a purchased/issued pin — that submission flow isn't built yet,
 * out of scope here), and approving it is what actually creates the
 * student account and generates their one-time login PIN.
 * ========================================================================== */

function randomDigits(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 10);
  return out;
}

const DECIDABLE_STATUSES = ["submitted", "under_review"];

export async function listApplications() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("applications")
    .select("id, application_number, full_name, programme, academic_year, status, created_at")
    .neq("status", "draft")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listApplications failed: ${error.message}`);
  return data || [];
}

export async function getApplication(applicationId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("applications")
    .select("id, application_number, full_name, programme, academic_year, phone, email, intake, study_mode, status, rejection_reason")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(`getApplication failed: ${error.message}`);
  if (!data) throw new Error("Application not found.");
  return data;
}

/** Best-effort default plan for a freshly admitted student: looks up the
 *  programme by name (both `programmes`, for the payment_plans FK, and
 *  `fee_structures`, for the amount) and creates a one-period "Registration
 *  & Semester 1" plan if both match. Deliberately swallows any failure —
 *  a typo'd programme name shouldn't block creating the student account,
 *  it should just leave them without a plan (AdminAddPaymentPlanActivity
 *  exists specifically to recover from that manually). Returns whether it
 *  actually created one, so callers can surface that to the admin if they
 *  want to.
 */
async function tryCreateDefaultPaymentPlan(studentRowId: string, programmeName: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data: programme } = await supabase
      .from("programmes").select("id").ilike("name", programmeName).maybeSingle();
    const { data: fees } = await supabase
      .from("fee_structures").select("registration_fee, tuition_per_semester").eq("programme", programmeName).maybeSingle();
    if (!programme || !fees) return false;

    const totalAmount = Number(fees.registration_fee) + Number(fees.tuition_per_semester);
    const today = new Date();
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + 6);

    const { data: plan, error: planError } = await supabase
      .from("payment_plans")
      .insert({
        student_row_id: studentRowId,
        programme_id: programme.id,
        label: "Registration & Semester 1",
        frequency: "semester",
        period_amount: totalAmount,
        total_amount: totalAmount,
        plan_start_date: today.toISOString().slice(0, 10),
        plan_end_date: endDate.toISOString().slice(0, 10),
        status: "active",
      })
      .select("id")
      .single();
    if (planError || !plan) return false;

    const { error: periodError } = await supabase.from("payment_periods").insert({
      payment_plan_id: plan.id,
      period_label: "Registration & Semester 1",
      period_index: 1,
      due_date: today.toISOString().slice(0, 10),
      amount_due: totalAmount,
      status: "due",
    });
    return !periodError;
  } catch {
    return false;
  }
}

export async function approveApplication(applicationId: string) {
  const supabase = getSupabase();

  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("id, status, full_name, phone, email, programme, academic_year")
    .eq("id", applicationId)
    .maybeSingle();
  if (appError) throw new Error(`approveApplication (lookup) failed: ${appError.message}`);
  if (!application) throw new Error("Application not found.");
  if (!DECIDABLE_STATUSES.includes(application.status)) {
    throw new Error(`This application is already ${application.status.replace("_", " ")} and can't be re-decided.`);
  }

  const year = application.academic_year || String(new Date().getFullYear());
  const { count: studentCount } = await supabase.from("students").select("id", { count: "exact", head: true });
  const seq = String((studentCount || 0) + 1).padStart(5, "0");
  const studentId = `MTEC-${year}-${seq}`;
  const pin = randomDigits(6);

  const { data: student, error: studentError } = await supabase.from("students").insert({
    student_id: studentId,
    student_pin: pin,
    application_id: application.id,
    full_name: application.full_name,
    phone: application.phone,
    email: application.email || "",
    programme: application.programme,
    academic_year: year,
    status: "active",
  }).select("id").single();
  if (studentError) throw new Error(`approveApplication (student insert) failed: ${studentError.message}`);

  const { error: updateError } = await supabase
    .from("applications").update({ status: "approved" }).eq("id", applicationId);
  if (updateError) throw new Error(`approveApplication (status update) failed: ${updateError.message}`);

  const paymentPlanCreated = await tryCreateDefaultPaymentPlan(student.id, application.programme);

  return { studentId, pin, paymentPlanCreated };
}

/** Walk-in fast-path: creates the same pin+application stand-in the public
 *  form does (source 'campus_sale' — an admin handing someone a spot is
 *  the in-person equivalent), then the student, then best-effort a default
 *  payment plan. Coexists with the Applications review flow rather than
 *  replacing it — this is for someone registering in person with nothing
 *  submitted online first. */
export interface RegisterStudentDirectInput {
  fullName: string;
  phone: string;
  email?: string;
  programme: string;
  academicYear: string;
  registeredBy: string;
}

export async function registerStudentDirect(input: RegisterStudentDirectInput) {
  const supabase = getSupabase();
  const year = input.academicYear || String(new Date().getFullYear());

  const { data: pin, error: pinError } = await supabase
    .from("application_pins")
    .insert({
      pin: `ADMIN-${Date.now()}`,
      academic_year: year,
      intake: "Direct Registration",
      status: "used",
      source: "campus_sale",
      applicant_name: input.fullName,
      applicant_phone: input.phone,
      applicant_email: input.email || null,
      programme_interest: input.programme,
      issued_by: input.registeredBy,
    })
    .select("id")
    .single();
  if (pinError) throw new Error(`registerStudentDirect (pin) failed: ${pinError.message}`);

  const { data: application, error: appError } = await supabase
    .from("applications")
    .insert({
      application_number: `APP-${Date.now()}`,
      pin_id: pin.id,
      status: "approved",
      full_name: input.fullName,
      phone: input.phone,
      email: input.email || "",
      academic_year: year,
      programme: input.programme,
    })
    .select("id")
    .single();
  if (appError) throw new Error(`registerStudentDirect (application) failed: ${appError.message}`);

  const { count: studentCount } = await supabase.from("students").select("id", { count: "exact", head: true });
  const seq = String((studentCount || 0) + 1).padStart(5, "0");
  const studentId = `MTEC-${year}-${seq}`;
  const pinCode = randomDigits(6);

  const { data: student, error: studentError } = await supabase.from("students").insert({
    student_id: studentId,
    student_pin: pinCode,
    application_id: application.id,
    full_name: input.fullName,
    phone: input.phone,
    email: input.email || "",
    programme: input.programme,
    academic_year: year,
    status: "active",
  }).select("id").single();
  if (studentError) throw new Error(`registerStudentDirect (student) failed: ${studentError.message}`);

  const paymentPlanCreated = await tryCreateDefaultPaymentPlan(student.id, input.programme);

  return { studentId, pin: pinCode, paymentPlanCreated };
}

export async function rejectApplication(applicationId: string, reason: string) {
  const supabase = getSupabase();

  const { data: application, error: appError } = await supabase
    .from("applications").select("status").eq("id", applicationId).maybeSingle();
  if (appError) throw new Error(`rejectApplication (lookup) failed: ${appError.message}`);
  if (!application) throw new Error("Application not found.");
  if (!DECIDABLE_STATUSES.includes(application.status)) {
    throw new Error(`This application is already ${application.status.replace("_", " ")} and can't be re-decided.`);
  }

  const { error } = await supabase
    .from("applications").update({ status: "rejected", rejection_reason: reason }).eq("id", applicationId);
  if (error) throw new Error(`rejectApplication failed: ${error.message}`);
  return { success: true };
}

/* ==========================================================================
 * Students — list/detail (row id included so the app can link into detail)
 * ========================================================================== */

export async function listStudents(search: string | undefined, limit: number) {
  const supabase = getSupabase();
  let query = supabase
    .from("students")
    .select("id, student_id, full_name, phone, programme, academic_year, level, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (search) {
    query = query.or(`full_name.ilike.%${search}%,student_id.ilike.%${search}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`listStudents failed: ${error.message}`);
  return data || [];
}

export async function getStudentDetail(studentRowId: string) {
  const supabase = getSupabase();
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, student_id, full_name, phone, email, programme, academic_year, level, status")
    .eq("id", studentRowId)
    .maybeSingle();
  if (studentError) throw new Error(`getStudentDetail failed: ${studentError.message}`);
  if (!student) throw new Error("Student not found.");

  // Payment plan totals — omitted entirely (not just zeroed) when there's no
  // active plan, since the app distinguishes "no plan" from "plan with a
  // zero balance" by whether the totalFees key exists at all.
  let totalFees: number | undefined;
  let amountPaid: number | undefined;
  const { data: plan } = await supabase
    .from("payment_plans")
    .select("id, total_amount")
    .eq("student_row_id", studentRowId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (plan) {
    totalFees = Number(plan.total_amount);
    const { data: periods } = await supabase
      .from("payment_periods").select("amount_paid").eq("payment_plan_id", plan.id);
    amountPaid = (periods || []).reduce((sum, p) => sum + Number(p.amount_paid), 0);
  }

  // Enrolled classes — empty until the Academics phase (creating classes)
  // is built; the query itself is correct groundwork for that.
  const { data: classes } = await supabase
    .from("classes").select("courses(name)").contains("student_ids", [studentRowId]);
  const courses = (classes || []).map((c: any) => c.courses?.name).filter(Boolean);

  return {
    ...student,
    ...(totalFees !== undefined ? { totalFees, amountPaid } : {}),
    courses,
  };
}

/* ==========================================================================
 * Payment Plans — manual creation (AdminAddPaymentPlanActivity), for
 * students who ended up without the auto-created default plan (programme
 * name typo, or registered before fee_structures had that programme).
 * ========================================================================== */

const FREQUENCY_STEP_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30, semester: 182 };

export interface CreatePaymentPlanInput {
  studentRowId: string;
  label: string;
  frequency: "daily" | "weekly" | "monthly" | "semester";
  totalAmount: number;
  periodCount: number;
  startDate: string; // YYYY-MM-DD
}

export async function createPaymentPlanForStudent(input: CreatePaymentPlanInput) {
  const supabase = getSupabase();

  const { data: existing } = await supabase
    .from("payment_plans").select("id").eq("student_row_id", input.studentRowId).eq("status", "active").maybeSingle();
  if (existing) throw new Error("This student already has an active payment plan.");

  const { data: student, error: studentError } = await supabase
    .from("students").select("programme").eq("id", input.studentRowId).maybeSingle();
  if (studentError) throw new Error(`createPaymentPlanForStudent (student lookup) failed: ${studentError.message}`);
  if (!student) throw new Error("Student not found.");

  const { data: programme, error: programmeError } = await supabase
    .from("programmes").select("id").ilike("name", student.programme).maybeSingle();
  if (programmeError) throw new Error(`createPaymentPlanForStudent (programme lookup) failed: ${programmeError.message}`);
  if (!programme) throw new Error(`No programme record matches "${student.programme}" — check it's spelled exactly as in Programmes.`);

  const stepDays = FREQUENCY_STEP_DAYS[input.frequency];
  const start = new Date(input.startDate);
  if (isNaN(start.getTime())) throw new Error("startDate must be a valid date (YYYY-MM-DD).");
  const end = new Date(start);
  end.setDate(end.getDate() + stepDays * input.periodCount);

  const { data: plan, error: planError } = await supabase
    .from("payment_plans")
    .insert({
      student_row_id: input.studentRowId,
      programme_id: programme.id,
      label: input.label,
      frequency: input.frequency,
      period_amount: Math.round((input.totalAmount / input.periodCount) * 100) / 100,
      total_amount: input.totalAmount,
      plan_start_date: start.toISOString().slice(0, 10),
      plan_end_date: end.toISOString().slice(0, 10),
      status: "active",
    })
    .select("id")
    .single();
  if (planError) throw new Error(`createPaymentPlanForStudent (plan) failed: ${planError.message}`);

  const baseAmount = Math.floor((input.totalAmount / input.periodCount) * 100) / 100;
  const remainder = Math.round((input.totalAmount - baseAmount * input.periodCount) * 100) / 100;
  const periods = [];
  for (let i = 0; i < input.periodCount; i++) {
    const dueDate = new Date(start);
    dueDate.setDate(dueDate.getDate() + stepDays * i);
    const amount = i === input.periodCount - 1 ? baseAmount + remainder : baseAmount; // last period absorbs rounding
    periods.push({
      payment_plan_id: plan.id,
      period_label: periodLabel(input.frequency, i + 1, dueDate),
      period_index: i + 1,
      due_date: dueDate.toISOString().slice(0, 10),
      amount_due: amount,
      status: dueDate <= new Date() ? "due" : "upcoming",
    });
  }
  const { error: periodsError } = await supabase.from("payment_periods").insert(periods);
  if (periodsError) throw new Error(`createPaymentPlanForStudent (periods) failed: ${periodsError.message}`);

  return { planId: plan.id, periodCount: periods.length };
}

function periodLabel(frequency: string, index: number, dueDate: Date): string {
  if (frequency === "monthly") {
    return dueDate.toLocaleString("en-US", { month: "long", year: "numeric" });
  }
  if (frequency === "semester") return `Semester ${index}`;
  if (frequency === "weekly") return `Week ${index}`;
  return `Day ${index}`;
}

export async function listFeeStructures() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("fee_structures").select("programme, registration_fee, tuition_per_semester").order("programme");
  if (error) throw new Error(`listFeeStructures failed: ${error.message}`);
  return data || [];
}

/* ==========================================================================
 * Transactions — full payment_submissions history (any status), the same
 * table/shape the Payments-pending queue reads from. "Verifying" a pending
 * one (see adminRoutes.ts /payments/:id/verify -> finalizeVerifiedPayment)
 * is what turns it into a settled transaction here.
 * ========================================================================== */

export async function listTransactions(limit: number) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("payment_submissions")
    .select("id, mtec_reference, amount, method, status, provider_reference, created_at, students(student_id, full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listTransactions failed: ${error.message}`);
  return data || [];
}

/** Pending cash submissions awaiting verification — same underlying
 *  table/queue the /staff cash-approval page uses; this just exposes it
 *  under normal admin JWT auth instead of the shared X-Staff-Token. */
export async function listPendingPayments() {
  return getPendingCashSubmissions();
}

export async function verifyPendingPayment(submissionId: string, verifiedByAdmin: string) {
  return finalizeVerifiedPayment(submissionId, `Cash (confirmed by ${verifiedByAdmin})`);
}

export async function rejectPendingPayment(submissionId: string, reason: string) {
  return rejectSubmission(submissionId, reason);
}

/* ==========================================================================
 * Courses — "Add Course" quick action
 * ========================================================================== */

export interface AddCourseInput {
  code: string;
  name: string;
  programme: string;
  level: string;
  semester: string;
  creditUnits: number;
}

export async function addCourse(input: AddCourseInput) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("courses")
    .insert({
      code: input.code,
      name: input.name,
      programme: input.programme,
      level: input.level,
      semester: input.semester,
      credit_units: input.creditUnits,
    })
    .select("id, code, name, programme, level, semester, credit_units")
    .single();
  if (error) throw new Error(`addCourse failed: ${error.message}`);
  return data;
}

/* ==========================================================================
 * Staff — "Manage Staff" quick action
 * ==========================================================================
 * POST /admin/setup only works once, ever (see adminAuthService) — this is
 * the ongoing path for an already-logged-in admin to add more accounts.
 * No role tiers yet: every account created here has full admin permissions,
 * same as the first one. Deactivation/removal isn't built yet either —
 * both are product decisions (can a staff-tier account approve payments but
 * not add courses? can admins remove each other?) worth a real answer
 * rather than a guess baked into the schema.
 * ========================================================================== */

export interface AddStaffInput {
  username: string;
  password: string;
  fullName: string;
}

export async function addStaff(input: AddStaffInput) {
  const supabase = getSupabase();
  const passwordHash = await bcrypt.hash(input.password, 10);
  const { data, error } = await supabase
    .from("admin_accounts")
    .insert({ username: input.username, password_hash: passwordHash, full_name: input.fullName, role: "administrator" })
    .select("id, username, full_name, role, created_at")
    .single();
  if (error) {
    // 23505 = unique violation on admin_accounts.username
    if ((error as any).code === "23505") throw new Error("That username is already taken.");
    throw new Error(`addStaff failed: ${error.message}`);
  }
  return data;
}

export async function listStaff() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("admin_accounts")
    .select("id, username, full_name, role, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listStaff failed: ${error.message}`);
  return data || [];
}

/* ==========================================================================
 * Grades — "Enter Grades" quick action
 * ==========================================================================
 * The real chain per schema.sql: a Class belongs to a Course and enrolls a
 * set of students; an Assessment Item belongs to a Class; a Mark is one
 * student's score on one Assessment Item. There's no shortcut around this —
 * a "grade" isn't meaningful without knowing which assessment it's for.
 * ========================================================================== */

export interface CreateClassInput {
  courseCode: string;
  instructorName: string;
  academicYear: string;
  studentIds: string[]; // human-readable student_id strings, e.g. MTEC-2026-00125
}

export async function createClass(input: CreateClassInput) {
  const supabase = getSupabase();

  const { data: course, error: courseError } = await supabase
    .from("courses").select("id, name").eq("code", input.courseCode).maybeSingle();
  if (courseError) throw new Error(`createClass (course lookup) failed: ${courseError.message}`);
  if (!course) throw new Error(`No course found with code ${input.courseCode}.`);

  let studentRowIds: string[] = [];
  if (input.studentIds.length > 0) {
    const { data: students, error: studentsError } = await supabase
      .from("students").select("id, student_id").in("student_id", input.studentIds);
    if (studentsError) throw new Error(`createClass (students lookup) failed: ${studentsError.message}`);
    const found = new Set((students || []).map((s) => s.student_id));
    const missing = input.studentIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw new Error(`No student found with ID(s): ${missing.join(", ")}.`);
    studentRowIds = (students || []).map((s) => s.id as string);
  }

  const { data, error } = await supabase
    .from("classes")
    .insert({
      course_id: course.id,
      instructor_name: input.instructorName,
      academic_year: input.academicYear,
      student_ids: studentRowIds,
    })
    .select("id, course_id, instructor_name, academic_year, student_ids")
    .single();
  if (error) throw new Error(`createClass failed: ${error.message}`);
  return { ...data, courseName: course.name, courseCode: input.courseCode };
}

export async function listClasses(courseId: string | undefined) {
  const supabase = getSupabase();
  let query = supabase
    .from("classes")
    .select("id, instructor_name, academic_year, student_ids, courses(code, name)");
  if (courseId) query = query.eq("course_id", courseId);
  const { data, error } = await query;
  if (error) throw new Error(`listClasses failed: ${error.message}`);
  return (data || []).map((c: any) => ({
    id: c.id,
    instructorName: c.instructor_name,
    academicYear: c.academic_year,
    studentCount: (c.student_ids || []).length,
    courseCode: c.courses?.code || "",
    courseName: c.courses?.name || "",
  }));
}

export async function getClassDetail(classId: string) {
  const supabase = getSupabase();
  const { data: cls, error } = await supabase
    .from("classes")
    .select("id, instructor_name, academic_year, student_ids, courses(code, name, programme)")
    .eq("id", classId)
    .maybeSingle();
  if (error) throw new Error(`getClassDetail failed: ${error.message}`);
  if (!cls) throw new Error("Class not found.");
  const courses = cls.courses as any;
  return {
    id: cls.id,
    instructorName: cls.instructor_name,
    academicYear: cls.academic_year,
    studentCount: (cls.student_ids || []).length,
    courseCode: courses?.code || "",
    courseName: courses?.name || "",
    programme: courses?.programme || "",
  };
}

/** Adds one more student to a class's roster by their human-readable
 *  student_id. Silently no-ops (rather than erroring) if already enrolled —
 *  re-adding the same student isn't a mistake worth blocking on. */
export async function addStudentToClass(classId: string, studentIdText: string) {
  const supabase = getSupabase();
  const { data: student, error: studentError } = await supabase
    .from("students").select("id, full_name").eq("student_id", studentIdText).maybeSingle();
  if (studentError) throw new Error(`addStudentToClass (student lookup) failed: ${studentError.message}`);
  if (!student) throw new Error(`No student found with ID ${studentIdText}.`);

  const { data: cls, error: classError } = await supabase
    .from("classes").select("student_ids").eq("id", classId).maybeSingle();
  if (classError) throw new Error(`addStudentToClass (class lookup) failed: ${classError.message}`);
  if (!cls) throw new Error("Class not found.");

  const current: string[] = cls.student_ids || [];
  if (current.includes(student.id)) return { alreadyEnrolled: true, fullName: student.full_name };

  const { error: updateError } = await supabase
    .from("classes").update({ student_ids: [...current, student.id] }).eq("id", classId);
  if (updateError) throw new Error(`addStudentToClass (update) failed: ${updateError.message}`);
  return { alreadyEnrolled: false, fullName: student.full_name };
}

export async function listClassStudents(classId: string) {
  const supabase = getSupabase();
  const { data: cls, error: classError } = await supabase
    .from("classes").select("student_ids").eq("id", classId).maybeSingle();
  if (classError) throw new Error(`listClassStudents (class lookup) failed: ${classError.message}`);
  if (!cls || !cls.student_ids || cls.student_ids.length === 0) return [];

  const { data, error } = await supabase
    .from("students").select("id, student_id, full_name").in("id", cls.student_ids as string[]);
  if (error) throw new Error(`listClassStudents failed: ${error.message}`);
  return (data || []).map((s) => ({ studentRowId: s.id, studentId: s.student_id, fullName: s.full_name }));
}

export interface CreateAssessmentItemInput {
  classId: string;
  name: string;
  maxScore: number;
  weight: number;
}

export async function createAssessmentItem(input: CreateAssessmentItemInput) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("assessment_items")
    .insert({ class_id: input.classId, name: input.name, max_score: input.maxScore, weight: input.weight })
    .select("id, class_id, name, max_score, weight")
    .single();
  if (error) throw new Error(`createAssessmentItem failed: ${error.message}`);
  return data;
}

export async function listAssessmentItems(classId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("assessment_items").select("id, name, max_score, weight").eq("class_id", classId);
  if (error) throw new Error(`listAssessmentItems failed: ${error.message}`);
  return data || [];
}

export interface SaveMarksInput {
  assessmentItemId: string;
  classId: string;
  scores: { studentRowId: string; score: number }[];
}

/** Upserts on the (assessment_item_id, student_row_id) unique constraint —
 *  re-submitting the same sheet corrects scores rather than duplicating them. */
export async function saveMarks(input: SaveMarksInput) {
  const supabase = getSupabase();
  const rows = input.scores.map((s) => ({
    assessment_item_id: input.assessmentItemId,
    class_id: input.classId,
    student_row_id: s.studentRowId,
    score: s.score,
  }));
  const { error } = await supabase
    .from("marks")
    .upsert(rows, { onConflict: "assessment_item_id,student_row_id" });
  if (error) throw new Error(`saveMarks failed: ${error.message}`);
  return { saved: rows.length };
}

export async function getMarks(assessmentItemId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("marks").select("student_row_id, score").eq("assessment_item_id", assessmentItemId);
  if (error) throw new Error(`getMarks failed: ${error.message}`);
  return data || [];
}

/* ==========================================================================
 * Attendance — per-class, per-date roster marking (present/absent/late/excused)
 * Same upsert shape as saveMarks: re-saving the same class+date corrects
 * marks rather than duplicating them (unique constraint on class_id,
 * student_row_id, date).
 * ========================================================================== */

const ATTENDANCE_MARKS = ["present", "absent", "late", "excused"];

export interface SaveAttendanceInput {
  classId: string;
  date: string; // YYYY-MM-DD
  marks: { studentRowId: string; mark: string }[];
}

export async function saveAttendance(input: SaveAttendanceInput) {
  const invalid = input.marks.find((m) => !ATTENDANCE_MARKS.includes(m.mark));
  if (invalid) throw new Error(`mark must be one of: ${ATTENDANCE_MARKS.join(", ")}.`);

  const supabase = getSupabase();
  const rows = input.marks.map((m) => ({
    class_id: input.classId,
    student_row_id: m.studentRowId,
    date: input.date,
    mark: m.mark,
  }));
  const { error } = await supabase
    .from("attendance_records")
    .upsert(rows, { onConflict: "class_id,student_row_id,date" });
  if (error) throw new Error(`saveAttendance failed: ${error.message}`);
  return { saved: rows.length };
}

/** Existing marks for one class+date, so the app can prefill an
 *  already-taken register instead of starting blank. */
export async function getClassAttendance(classId: string, date: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("attendance_records")
    .select("student_row_id, mark")
    .eq("class_id", classId)
    .eq("date", date);
  if (error) throw new Error(`getClassAttendance failed: ${error.message}`);
  return data || [];
}

/* ==========================================================================
 * Results — assessment_items/marks already exist above (Enter Grades).
 * This is the class-level publish gate on top of them: result_batches.status
 * controls whether a student can see their marks at all (see
 * studentInfoService.getResults, which only returns marks for classes whose
 * batch is 'published'). Only three states exist in the schema — draft,
 * pending_review, published — not the plan's full five-stage HOD workflow;
 * with a single admin tier (see addStaff's own note on that), there's no
 * separate approver to hand pending_review off to, so "submit" and
 * "approve" are both just admin actions on the same batch.
 * ========================================================================== */

export async function getResultBatchStatus(classId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("result_batches")
    .select("status, sent_back_reason, submitted_at, published_at")
    .eq("class_id", classId)
    .maybeSingle();
  if (error) throw new Error(`getResultBatchStatus failed: ${error.message}`);
  // No row yet just means grading hasn't started — that's a draft, not an error.
  return data || { status: "draft", sent_back_reason: null, submitted_at: null, published_at: null };
}

export async function submitResultsForReview(classId: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("result_batches")
    .upsert({ class_id: classId, status: "pending_review", submitted_at: new Date().toISOString(), sent_back_reason: null },
      { onConflict: "class_id" });
  if (error) throw new Error(`submitResultsForReview failed: ${error.message}`);
  return { status: "pending_review" };
}

export async function publishResults(classId: string) {
  const supabase = getSupabase();
  const { data: batch } = await supabase.from("result_batches").select("status").eq("class_id", classId).maybeSingle();
  if (!batch || batch.status !== "pending_review") {
    throw new Error("Results must be submitted for review before they can be published.");
  }
  const { error } = await supabase
    .from("result_batches")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("class_id", classId);
  if (error) throw new Error(`publishResults failed: ${error.message}`);
  return { status: "published" };
}

export async function returnResultsToLecturer(classId: string, reason: string) {
  const supabase = getSupabase();
  const { data: batch } = await supabase.from("result_batches").select("status").eq("class_id", classId).maybeSingle();
  if (!batch || batch.status !== "pending_review") {
    throw new Error("Only results awaiting review can be sent back.");
  }
  const { error } = await supabase
    .from("result_batches")
    .update({ status: "draft", sent_back_reason: reason, submitted_at: null })
    .eq("class_id", classId);
  if (error) throw new Error(`returnResultsToLecturer failed: ${error.message}`);
  return { status: "draft" };
}

export async function listCourses(search: string | undefined, limit: number) {
  const supabase = getSupabase();
  let query = supabase
    .from("courses")
    .select("id, code, name, programme, level, semester, credit_units")
    .order("code", { ascending: true })
    .limit(limit);
  if (search) {
    query = query.or(`code.ilike.%${search}%,name.ilike.%${search}%,programme.ilike.%${search}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`listCourses failed: ${error.message}`);
  return data || [];
}

/** Course Detail's aggregate numbers (class count, distinct enrolled
 *  students across every class of this course) computed here rather than
 *  trusting the app to add them up client-side from a classes list. */
export async function getCourse(courseId: string) {
  const supabase = getSupabase();
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, code, name, programme, level, semester, credit_units")
    .eq("id", courseId)
    .maybeSingle();
  if (courseError) throw new Error(`getCourse failed: ${courseError.message}`);
  if (!course) throw new Error("Course not found.");

  const { data: classes, error: classesError } = await supabase
    .from("classes").select("student_ids").eq("course_id", courseId);
  if (classesError) throw new Error(`getCourse (classes) failed: ${classesError.message}`);

  const distinctStudents = new Set<string>();
  for (const c of classes || []) for (const id of (c.student_ids as string[] | null) || []) distinctStudents.add(id);

  return { ...course, classCount: (classes || []).length, studentCount: distinctStudents.size };
}

/* ==========================================================================
 * Admin self-service password change
 * ========================================================================== */

export async function changeAdminPassword(adminId: string, currentPassword: string, newPassword: string) {
  const supabase = getSupabase();
  const { data: admin, error } = await supabase
    .from("admin_accounts").select("password_hash").eq("id", adminId).maybeSingle();
  if (error) throw new Error(`changeAdminPassword (lookup) failed: ${error.message}`);
  if (!admin) throw new Error("Account not found.");

  const matches = await bcrypt.compare(currentPassword, admin.password_hash as string);
  if (!matches) throw new Error("Current password is incorrect.");

  const newHash = await bcrypt.hash(newPassword, 10);
  const { error: updateError } = await supabase
    .from("admin_accounts").update({ password_hash: newHash }).eq("id", adminId);
  if (updateError) throw new Error(`changeAdminPassword (update) failed: ${updateError.message}`);
  return { success: true };
}

/* ==========================================================================
 * Chat — one thread per student (migrations/003_chat_messages.sql).
 * Used by both AdminChatActivity (staff side) and ChatActivity (student's
 * own thread, via studentInfoRoutes.ts).
 * ========================================================================== */

export async function listThreadsNeedingReply() {
  const supabase = getSupabase();
  // Latest message per student, then keep only the threads where that
  // latest message came from the student (nobody's replied yet).
  const { data, error } = await supabase
    .from("chat_messages")
    .select("student_row_id, sender_type, message, created_at, students(student_id, full_name)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listThreadsNeedingReply failed: ${error.message}`);

  const latestByStudent = new Map<string, any>();
  for (const row of data || []) {
    if (!latestByStudent.has(row.student_row_id)) latestByStudent.set(row.student_row_id, row);
  }
  return Array.from(latestByStudent.values())
    .filter((row) => row.sender_type === "student")
    .map((row: any) => ({
      studentRowId: row.student_row_id,
      studentId: row.students?.student_id || "",
      studentName: row.students?.full_name || "",
      lastMessage: row.message,
      lastMessageAt: row.created_at,
    }));
}

export async function getChatThread(studentRowId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("sender_type, sender_name, message, created_at")
    .eq("student_row_id", studentRowId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getChatThread failed: ${error.message}`);
  return data || [];
}

export async function sendAdminChatMessage(studentRowId: string, message: string, adminName: string) {
  const supabase = getSupabase();
  const { error } = await supabase.from("chat_messages").insert({
    student_row_id: studentRowId, sender_type: "staff", sender_name: adminName, message,
  });
  if (error) throw new Error(`sendAdminChatMessage failed: ${error.message}`);
  return { success: true };
}

export async function sendStudentChatMessage(studentRowId: string, message: string, studentName: string) {
  const supabase = getSupabase();
  const { error } = await supabase.from("chat_messages").insert({
    student_row_id: studentRowId, sender_type: "student", sender_name: studentName, message,
  });
  if (error) throw new Error(`sendStudentChatMessage failed: ${error.message}`);
  return { success: true };
}

/* ==========================================================================
 * Timetable — per-class weekly schedule (Phase B / Timetable UI)
 * ========================================================================== */

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function listTimetableSlots(classId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("timetable_slots")
    .select("id, day_of_week, start_time, end_time, room")
    .eq("class_id", classId);
  if (error) throw new Error(`listTimetableSlots failed: ${error.message}`);
  return (data || []).sort((a, b) => {
    const dayDiff = DAY_ORDER.indexOf(a.day_of_week) - DAY_ORDER.indexOf(b.day_of_week);
    return dayDiff !== 0 ? dayDiff : a.start_time.localeCompare(b.start_time);
  });
}

export interface AddTimetableSlotInput {
  classId: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  room: string;
}

export async function addTimetableSlot(input: AddTimetableSlotInput) {
  if (!DAY_ORDER.includes(input.dayOfWeek)) {
    throw new Error(`dayOfWeek must be one of: ${DAY_ORDER.join(", ")}.`);
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("timetable_slots")
    .insert({
      class_id: input.classId,
      day_of_week: input.dayOfWeek,
      start_time: input.startTime,
      end_time: input.endTime,
      room: input.room,
    })
    .select("id, day_of_week, start_time, end_time, room")
    .single();
  if (error) throw new Error(`addTimetableSlot failed: ${error.message}`);
  return data;
}

export async function deleteTimetableSlot(slotId: string) {
  const supabase = getSupabase();
  const { error } = await supabase.from("timetable_slots").delete().eq("id", slotId);
  if (error) throw new Error(`deleteTimetableSlot failed: ${error.message}`);
  return { success: true };
}
