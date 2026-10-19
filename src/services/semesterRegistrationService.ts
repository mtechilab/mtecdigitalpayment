import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { windowState, amountDue, validateWindowInput, validateCourses, Window } from "./semesterRegistrationPolicy.js";
import { validateReference, validateReceipt, PAYMENT_METHODS } from "./applicationPaymentPolicy.js";

const BUCKET = "semester-receipts";
const LINK_SECONDS = 300;

interface WindowRow { id: string; semester_name: string; academic_year: string; opens_at: string; closes_at: string; late_closes_at: string | null; late_surcharge_percent: number; is_open: boolean }

async function windowRow(semester: string, year: string): Promise<WindowRow | null> {
  const { data, error } = await getSupabase().from("semester_windows").select("*")
    .eq("semester_name", semester).eq("academic_year", year).maybeSingle();
  if (error) throw new Error(`windowRow failed: ${error.message}`);
  return (data as unknown as WindowRow | null) || null;
}

function toWindow(w: WindowRow): Window {
  return { opensAt: w.opens_at, closesAt: w.closes_at, lateClosesAt: w.late_closes_at, surchargePercent: w.late_surcharge_percent, isOpen: w.is_open };
}

async function tuitionFor(studentRowId: string): Promise<{ programme: string; tuition: number }> {
  const supabase = getSupabase();
  const { data: student } = await supabase.from("students").select("programme").eq("id", studentRowId).maybeSingle();
  const programme = (student as unknown as { programme: string } | null)?.programme;
  if (!programme) throw new Error("This student has no programme. Contact admissions.");
  const { data: fee } = await supabase.from("fee_structures").select("tuition_per_semester").eq("programme", programme).maybeSingle();
  const tuition = (fee as unknown as { tuition_per_semester: number } | null)?.tuition_per_semester;
  if (typeof tuition !== "number") throw new Error("The semester fee for this programme is not set. Contact admissions.");
  return { programme, tuition };
}

async function registrationFor(studentRowId: string, semester: string, year: string) {
  const { data } = await getSupabase().from("semester_registrations").select("*")
    .eq("student_row_id", studentRowId).eq("semester_name", semester).eq("academic_year", year).maybeSingle();
  return (data as unknown as Record<string, unknown> | null) || null;
}

/** The student's view: whether registration is open, what they owe, their status, and their courses once confirmed. */
export async function studentSemesterStatus(studentRowId: string, semester: string, year: string) {
  const win = await windowRow(semester, year);
  if (!win) return { semester, academicYear: year, state: "not_set", message: "Registration for this semester has not been opened yet." };
  const state = windowState(toWindow(win));
  const { tuition } = await tuitionFor(studentRowId);
  const reg = await registrationFor(studentRowId, semester, year);
  const confirmed = reg && reg.status === "confirmed";
  let courses: { code: string; name: string }[] = [];
  if (confirmed) {
    const { data } = await getSupabase().from("student_course_assignments").select("course_code, course_name")
      .eq("student_row_id", studentRowId).eq("semester_name", semester).eq("academic_year", year);
    courses = ((data || []) as unknown as { course_code: string; course_name: string }[]).map((c) => ({ code: c.course_code, name: c.course_name }));
  }
  return {
    semester, academicYear: year, state,
    surchargePercent: win.late_surcharge_percent,
    amountDue: state === "open" || state === "late" ? amountDue(tuition, state, win.late_surcharge_percent) : null,
    registration: reg ? { status: reg.status, late: reg.late, reviewReason: reg.review_reason } : null,
    courses,
  };
}

/** The student pays before registration. Their payment waits for the admin to verify it. */
export async function submitSemesterPayment(studentRowId: string, semester: string, year: string, input: {
  method: unknown; reference?: unknown; receiptBase64?: unknown; receiptContentType?: unknown;
}) {
  const win = await windowRow(semester, year);
  if (!win) throw new Error("Registration for this semester has not been opened yet.");
  const state = windowState(toWindow(win));
  if (state !== "open" && state !== "late") throw new Error("Registration is closed for this semester.");
  const reg = await registrationFor(studentRowId, semester, year);
  if (reg && reg.status === "confirmed") throw new Error("You are already registered for this semester.");
  if (reg && reg.status === "payment_pending") throw new Error("A payment is already waiting for review.");
  const { tuition } = await tuitionFor(studentRowId);
  const amount = amountDue(tuition, state, win.late_surcharge_percent);
  const supabase = getSupabase();
  const values: Record<string, unknown> = {
    student_row_id: studentRowId, semester_name: semester, academic_year: year, status: "payment_pending",
    amount_due: amount, late: state === "late", submitted_at: new Date().toISOString(), review_reason: null,
  };

  if (input.method === "orange_money") {
    const problem = validateReference(input.reference);
    if (problem) throw new Error(problem);
    values.payment_method = "orange_money";
    values.payment_reference = (input.reference as string).trim();
  } else if (input.method === "cash") {
    const problem = validateReceipt(input.receiptContentType, input.receiptBase64);
    if (problem) throw new Error(problem);
    const contentType = input.receiptContentType as string;
    const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const path = `${studentRowId}/${semester.replace(/\s+/g, "-")}-${year.replace(/\//g, "-")}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET)
      .upload(path, Buffer.from(input.receiptBase64 as string, "base64"), { contentType, upsert: false });
    if (uploadError) throw new Error(`Could not store the receipt: ${uploadError.message}`);
    values.payment_method = "cash";
    values.receipt_path = path;
    values.receipt_type = contentType;
  } else {
    throw new Error(`Choose ${PAYMENT_METHODS.join(" or ")}.`);
  }

  const { error } = await supabase.from("semester_registrations").upsert(values, { onConflict: "student_row_id,semester_name,academic_year" });
  if (error) throw new Error(`submitSemesterPayment failed: ${error.message}`);
  return { success: true, status: "payment_pending", amountDue: amount };
}

/** Admin: opens or changes a semester's registration window. */
export async function setWindow(admin: string, input: {
  semester: string; academicYear: string; opensAt: string; closesAt: string; lateClosesAt: string | null; surchargePercent: number; isOpen: boolean;
}) {
  const problem = validateWindowInput(input);
  if (problem) throw new Error(problem);
  const { data: sem } = await getSupabase().from("semesters").select("name").eq("name", input.semester).maybeSingle();
  if (!sem) throw new Error("Choose a semester that exists.");
  const { error } = await getSupabase().from("semester_windows").upsert({
    semester_name: input.semester, academic_year: input.academicYear, opens_at: input.opensAt, closes_at: input.closesAt,
    late_closes_at: input.lateClosesAt, late_surcharge_percent: input.surchargePercent, is_open: input.isOpen,
    updated_at: new Date().toISOString(), updated_by: admin,
  }, { onConflict: "semester_name,academic_year" });
  if (error) throw new Error(`setWindow failed: ${error.message}`);
  await recordAudit({ actor: admin, action: input.isOpen ? "semester.window_open" : "semester.window_closed", entityType: "semester", entityId: input.semester, detail: { year: input.academicYear } });
  return { success: true };
}

/** Admin: the registrations waiting for payment verification. */
export async function listPendingRegistrations(semester: string, year: string) {
  const { data, error } = await getSupabase().from("semester_registrations")
    .select("id, student_row_id, status, amount_due, late, payment_method, payment_reference, receipt_path, submitted_at")
    .eq("semester_name", semester).eq("academic_year", year).eq("status", "payment_pending")
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(`listPendingRegistrations failed: ${error.message}`);
  const rows = (data || []) as unknown as { id: string; student_row_id: string; amount_due: number; late: boolean; payment_method: string; payment_reference: string | null; receipt_path: string | null; submitted_at: string }[];
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.student_row_id))];
  const { data: students } = await getSupabase().from("students").select("id, student_id, full_name, programme, level").in("id", ids);
  const byId = new Map(((students || []) as unknown as { id: string; student_id: string; full_name: string; programme: string; level: string }[]).map((s) => [s.id, s]));
  return rows.map((r) => {
    const s = byId.get(r.student_row_id);
    return {
      id: r.id, amountDue: r.amount_due, late: r.late, method: r.payment_method, reference: r.payment_reference,
      hasReceipt: !!r.receipt_path, submittedAt: r.submitted_at,
      studentId: s?.student_id || "", fullName: s?.full_name || "", programme: s?.programme || "", level: s?.level || "",
    };
  });
}

/** Admin: verify the payment to confirm the registration, or reject it with a reason so the student can pay again. */
export async function reviewSemesterPayment(admin: string, registrationId: string, decision: unknown, reason: unknown) {
  if (decision !== "verify" && decision !== "reject") throw new Error("The decision must be verify or reject.");
  const supabase = getSupabase();
  const { data, error } = await supabase.from("semester_registrations").select("id, status").eq("id", registrationId).maybeSingle();
  if (error) throw new Error(`reviewSemesterPayment failed: ${error.message}`);
  const row = data as unknown as { id: string; status: string } | null;
  if (!row) throw new Error("That registration was not found.");
  if (row.status !== "payment_pending") throw new Error("This payment has already been reviewed.");
  const now = new Date().toISOString();
  if (decision === "verify") {
    const { error: upd } = await supabase.from("semester_registrations").update({
      status: "confirmed", reviewed_at: now, reviewed_by: admin, confirmed_at: now, review_reason: null,
    }).eq("id", registrationId);
    if (upd) throw new Error(`reviewSemesterPayment failed: ${upd.message}`);
    await recordAudit({ actor: admin, action: "semester.registration_confirm", entityType: "semester_registration", entityId: registrationId, detail: {} });
    return { success: true, status: "confirmed" };
  }
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < 3 || text.length > 300) throw new Error("Give a reason of 3 to 300 characters.");
  const { error: rej } = await supabase.from("semester_registrations").update({
    status: "payment_rejected", reviewed_at: now, reviewed_by: admin, review_reason: text,
  }).eq("id", registrationId);
  if (rej) throw new Error(`reviewSemesterPayment failed: ${rej.message}`);
  await recordAudit({ actor: admin, action: "semester.registration_reject", entityType: "semester_registration", entityId: registrationId, detail: {} });
  return { success: true, status: "payment_rejected" };
}

/** Admin: the courses for a student in a semester. Replaces the list for that student. */
export async function assignCourses(admin: string, studentRowId: string, semester: string, year: string, courses: unknown) {
  const problem = validateCourses(courses);
  if (problem) throw new Error(problem);
  const supabase = getSupabase();
  const { data: student } = await supabase.from("students").select("id").eq("id", studentRowId).maybeSingle();
  if (!student) throw new Error("That student was not found.");
  const list = courses as { code: string; name: string }[];
  const { error: delErr } = await supabase.from("student_course_assignments").delete()
    .eq("student_row_id", studentRowId).eq("semester_name", semester).eq("academic_year", year);
  if (delErr) throw new Error(`assignCourses failed: ${delErr.message}`);
  if (list.length > 0) {
    const { error } = await supabase.from("student_course_assignments").insert(list.map((c) => ({
      student_row_id: studentRowId, semester_name: semester, academic_year: year,
      course_code: c.code.trim().toUpperCase(), course_name: c.name.trim(), assigned_by: admin,
    })));
    if (error) throw new Error(`assignCourses failed: ${error.message}`);
  }
  await recordAudit({ actor: admin, action: "semester.courses_assign", entityType: "student", entityId: studentRowId, detail: { semester, year, count: list.length } });
  return { success: true, count: list.length };
}

/** Admin: a short-lived link to a payment receipt photo. */
export async function registrationReceiptLink(registrationId: string) {
  const { data } = await getSupabase().from("semester_registrations").select("receipt_path").eq("id", registrationId).maybeSingle();
  const path = (data as unknown as { receipt_path: string | null } | null)?.receipt_path;
  if (!path) throw new Error("That payment has no receipt photo.");
  const { data: signed, error } = await getSupabase().storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS);
  if (error || !signed) throw new Error(`Could not create the receipt link: ${error?.message || "unknown"}`);
  return { url: signed.signedUrl, expiresInSeconds: LINK_SECONDS };
}
