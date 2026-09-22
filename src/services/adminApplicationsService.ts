import crypto from "crypto";
import { getSupabase } from "../db/supabaseClient.js";

export async function listApplications(status?: string) {
  const supabase = getSupabase();
  let query = supabase
    .from("applications")
    .select("id, application_number, full_name, programme, academic_year, status, created_at")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`listApplications failed: ${error.message}`);
  return data;
}

export async function getApplication(id: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("applications").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getApplication failed: ${error.message}`);
  return data;
}

/** Derives a short programme code for the student ID from the programme
 *  name — e.g. "Diploma in Computer Science" -> "CS", "HND Business
 *  Administration" -> "BA". Drops filler words rather than trying to be
 *  clever; falls back to the first 2 letters of the whole name if nothing
 *  meaningful is left, so it never produces an empty code. */
function programmeCode(programmeName: string): string {
  const filler = new Set(["diploma", "certificate", "hnd", "bachelor", "in", "of", "and", "the"]);
  const words = programmeName.split(/\s+/).filter((w) => w && !filler.has(w.toLowerCase()));
  const code = words.map((w) => w[0]).join("").toUpperCase();
  return code.length >= 2 ? code.slice(0, 4) : programmeName.slice(0, 2).toUpperCase();
}

async function generateStudentId(programme: string, academicYear: string): Promise<string> {
  const supabase = getSupabase();
  const code = programmeCode(programme);
  const year = academicYear.match(/\d{4}/)?.[0] || new Date().getFullYear().toString();
  const prefix = `MTEC-${code}-${year}-`;

  const { count, error } = await supabase
    .from("students").select("id", { count: "exact", head: true }).like("student_id", `${prefix}%`);
  if (error) throw new Error(`generateStudentId count failed: ${error.message}`);

  const sequence = (count || 0) + 1;
  return `${prefix}${sequence.toString().padStart(4, "0")}`;
}

function generatePin(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export type AdmitResult = { studentId: string; pin: string };

/** The actual "make this person a student" step — creates the offer
 *  letter, the student row, AND a real payment plan with periods (the
 *  part that was missing before: approveApplication used to create a
 *  student with no payment plan at all, leaving the payment app unusable
 *  for them until someone manually inserted one). Shared by both the
 *  application-approval flow and admin's direct "Add Student" flow, so
 *  both produce a fully-usable student account the same way. */
async function admitStudent(params: {
  applicationId: string;
  fullName: string;
  phone: string;
  email: string;
  programme: string;
  academicYear: string;
}): Promise<AdmitResult> {
  const supabase = getSupabase();
  const { applicationId, fullName, phone, email, programme, academicYear } = params;

  const studentId = await generateStudentId(programme, academicYear);
  const pin = generatePin();

  const { data: feeRow } = await supabase
    .from("fee_structures").select("registration_fee, tuition_per_semester")
    .eq("programme", programme).maybeSingle();
  const feesAmount = feeRow ? Number(feeRow.registration_fee) + Number(feeRow.tuition_per_semester) : 0;

  const { data: programmeRow } = await supabase
    .from("programmes").select("id").eq("name", programme).maybeSingle();

  const applicationNumber = `MTEC-APP-${academicYear}-${applicationId.slice(0, 8)}`;
  const reportingDate = new Date();
  reportingDate.setDate(reportingDate.getDate() + 14);
  const acceptanceDeadline = new Date();
  acceptanceDeadline.setDate(acceptanceDeadline.getDate() + 7);

  const { error: offerErr } = await supabase.from("offer_letters").insert({
    application_id: applicationId,
    student_name: fullName,
    application_number: applicationNumber,
    programme,
    academic_year: academicYear,
    admission_conditions: "Admission is conditional on payment of the registration fee and submission of original documents at reporting.",
    fees_amount: feesAmount,
    reporting_date: reportingDate.toISOString().slice(0, 10),
    authorized_signatory: "MTeC Admissions",
    acceptance_deadline: acceptanceDeadline.toISOString().slice(0, 10),
  });
  if (offerErr) throw new Error(`admitStudent offer_letters insert failed: ${offerErr.message}`);

  const { data: studentRow, error: studentErr } = await supabase.from("students").insert({
    student_id: studentId,
    student_pin: pin,
    application_id: applicationId,
    full_name: fullName,
    phone,
    email,
    programme,
    academic_year: academicYear,
    level: "Year 1",
    status: "active",
  }).select("id").maybeSingle();
  if (studentErr || !studentRow) throw new Error(`admitStudent students insert failed: ${studentErr?.message}`);

  // Real payment plan: one semester, split into 3 monthly periods, due
  // 30/60/90 days out. feesAmount of 0 (no fee_structures row for this
  // programme yet) still creates the plan/periods — just with 0 amounts —
  // rather than silently skipping it, so the student record is never in
  // the same "payment app broken for this person" state as before.
  const { data: plan, error: planErr } = await supabase.from("payment_plans").insert({
    student_row_id: studentRow.id,
    programme_id: programmeRow?.id,
    label: "Semester 1",
    frequency: "monthly",
    period_amount: Math.round((feesAmount / 3) * 100) / 100,
    total_amount: feesAmount,
    plan_start_date: new Date().toISOString().slice(0, 10),
    plan_end_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    status: "active",
  }).select("id").maybeSingle();
  if (planErr || !plan) throw new Error(`admitStudent payment_plans insert failed: ${planErr?.message}`);

  const periodAmount = Math.round((feesAmount / 3) * 100) / 100;
  const periodLabels = ["Month 1", "Month 2", "Month 3"];
  const periodInserts = periodLabels.map((label, i) => ({
    payment_plan_id: plan.id,
    period_label: label,
    period_index: i + 1,
    due_date: new Date(Date.now() + (i + 1) * 30 * 86400000).toISOString().slice(0, 10),
    amount_due: periodAmount,
    amount_paid: 0,
    status: "due",
  }));
  const { error: periodsErr } = await supabase.from("payment_periods").insert(periodInserts);
  if (periodsErr) throw new Error(`admitStudent payment_periods insert failed: ${periodsErr.message}`);

  return { studentId, pin };
}

export type ApproveResult =
  | { outcome: "success"; studentId: string; pin: string }
  | { outcome: "not_found" }
  | { outcome: "already_processed"; status: string };

/** Approves an application and admits the student — see admitStudent()
 *  for what that actually creates (offer letter, student row, AND a real
 *  payment plan, which used to be missing entirely). */
export async function approveApplication(applicationId: string): Promise<ApproveResult> {
  const supabase = getSupabase();

  const { data: application, error: appErr } = await supabase
    .from("applications").select("*").eq("id", applicationId).maybeSingle();
  if (appErr) throw new Error(`approveApplication lookup failed: ${appErr.message}`);
  if (!application) return { outcome: "not_found" };
  if (application.status === "approved") return { outcome: "already_processed", status: application.status };

  const { studentId, pin } = await admitStudent({
    applicationId,
    fullName: application.full_name,
    phone: application.phone,
    email: application.email,
    programme: application.programme,
    academicYear: application.academic_year,
  });

  const { error: updateErr } = await supabase
    .from("applications").update({ status: "approved" }).eq("id", applicationId);
  if (updateErr) throw new Error(`approveApplication status update failed: ${updateErr.message}`);

  return { outcome: "success", studentId, pin };
}

/** Admin's direct "Add Student" flow — for a walk-in student who pays and
 *  registers on the spot, without going through the online application
 *  form first. Creates a fresh application_pins + applications row marked
 *  already-approved (so it shows correctly in the Applications list/
 *  audit trail — this student did go through an application, it was just
 *  taken by staff directly rather than submitted online), then calls the
 *  same admitStudent() used by the normal approval flow. */
export async function addStudentDirect(params: {
  fullName: string;
  phone: string;
  email: string;
  programme: string;
  academicYear: string;
}): Promise<AdmitResult> {
  const supabase = getSupabase();
  const { fullName, phone, email, programme, academicYear } = params;

  const { data: pinRow, error: pinErr } = await supabase.from("application_pins").insert({
    pin: "PIN-" + crypto.randomBytes(4).toString("hex"),
    academic_year: academicYear,
    intake: academicYear,
    status: "used",
    source: "campus_sale",
    applicant_name: fullName,
    applicant_phone: phone,
    programme_interest: programme,
  }).select("id").maybeSingle();
  if (pinErr || !pinRow) throw new Error(`addStudentDirect application_pins insert failed: ${pinErr?.message}`);

  const { data: application, error: appErr } = await supabase.from("applications").insert({
    pin_id: pinRow.id,
    status: "approved",
    full_name: fullName,
    phone,
    email,
    academic_year: academicYear,
    intake: academicYear,
    programme,
    study_mode: "Full-time",
    declaration_confirmed: true,
    submitted_at: new Date().toISOString(),
  }).select("id").maybeSingle();
  if (appErr || !application) throw new Error(`addStudentDirect applications insert failed: ${appErr?.message}`);

  return admitStudent({
    applicationId: application.id,
    fullName, phone, email, programme, academicYear,
  });
}

export async function rejectApplication(applicationId: string, reason: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("applications").update({ status: "rejected", rejection_reason: reason }).eq("id", applicationId);
  if (error) throw new Error(`rejectApplication failed: ${error.message}`);
}
