import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { DuplicateRequestError } from "./errors.js";
import { validateAssignment, validateSubmission, validateGrade, isOpen, AssignmentInput } from "./assignmentPolicy.js";

export interface Teacher { id: string; fullName: string }

async function ownAssignment(owner: Teacher, id: string) {
  const { data, error } = await getSupabase().from("assignments").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`ownAssignment failed: ${error.message}`);
  if (!data || data.owner_staff_id !== owner.id) throw new Error("That assignment was not found.");
  return data;
}

export async function createAssignment(owner: Teacher, input: AssignmentInput) {
  const problem = validateAssignment(input);
  if (problem) throw new Error(problem);
  const { data, error } = await getSupabase().from("assignments").insert({
    owner_staff_id: owner.id, owner_name: owner.fullName, title: input.title.trim(), instructions: input.instructions.trim(),
    programme: input.programme.trim(), course_code: (input.courseCode || "").trim(),
    due_at: new Date(input.dueAt).toISOString(), status: "draft",
  }).select("id, status, due_at").single();
  if (error) throw new Error(`createAssignment failed: ${error.message}`);
  return data;
}

export async function publishAssignment(owner: Teacher, id: string) {
  const current = await ownAssignment(owner, id);
  if (current.status === "published") return { success: true };
  if (!isOpen(current.due_at as string)) throw new Error("This assignment's due date has passed. Set a new due date first.");
  const { error } = await getSupabase().from("assignments")
    .update({ status: "published", published_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`publishAssignment failed: ${error.message}`);
  await recordAudit({ actor: owner.fullName, action: "assignment.publish", entityType: "assignment", entityId: id, detail: { programme: current.programme } });
  return { success: true };
}

export async function listOwnAssignments(owner: Teacher) {
  const { data, error } = await getSupabase().from("assignments")
    .select("id, title, programme, course_code, due_at, status").eq("owner_staff_id", owner.id)
    .order("due_at", { ascending: false }).limit(200);
  if (error) throw new Error(`listOwnAssignments failed: ${error.message}`);
  return data || [];
}

/** Every submission for one assignment, for the lecturer who set it. */
export async function listSubmissions(owner: Teacher, id: string) {
  await ownAssignment(owner, id);
  const supabase = getSupabase();
  const { data: rows, error } = await supabase.from("assignment_submissions")
    .select("id, student_row_id, body, submitted_at, score, feedback, graded_at").eq("assignment_id", id)
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(`listSubmissions failed: ${error.message}`);
  const ids = (rows || []).map((r) => r.student_row_id as string);
  const names = new Map<string, { student_id: string; full_name: string }>();
  if (ids.length > 0) {
    const { data: students, error: sErr } = await supabase.from("students").select("id, student_id, full_name").in("id", ids);
    if (sErr) throw new Error(`listSubmissions (students) failed: ${sErr.message}`);
    for (const s of students || []) names.set(s.id as string, { student_id: s.student_id as string, full_name: s.full_name as string });
  }
  return (rows || []).map((r) => ({
    submissionId: r.id, studentId: names.get(r.student_row_id as string)?.student_id || "",
    studentName: names.get(r.student_row_id as string)?.full_name || "", body: r.body,
    submittedAt: r.submitted_at, score: r.score, feedback: r.feedback, gradedAt: r.graded_at,
  }));
}

/** Grades one submission. Only the lecturer who set the assignment can grade it. */
export async function gradeSubmission(owner: Teacher, submissionId: string, score: unknown, feedback: unknown) {
  const problem = validateGrade(score, feedback);
  if (problem) throw new Error(problem);
  const supabase = getSupabase();
  const { data: sub, error } = await supabase.from("assignment_submissions").select("id, assignment_id").eq("id", submissionId).maybeSingle();
  if (error) throw new Error(`gradeSubmission failed: ${error.message}`);
  if (!sub) throw new Error("That submission was not found.");
  await ownAssignment(owner, sub.assignment_id as string);
  const { error: updateError } = await supabase.from("assignment_submissions")
    .update({ score: score as number, feedback: typeof feedback === "string" ? feedback.trim() : null, graded_at: new Date().toISOString() })
    .eq("id", submissionId);
  if (updateError) throw new Error(`gradeSubmission (update) failed: ${updateError.message}`);
  await recordAudit({ actor: owner.fullName, action: "assignment.grade", entityType: "assignment_submission", entityId: submissionId, detail: { score: score as number } });
  return { success: true };
}

async function studentProgramme(studentRowId: string): Promise<string> {
  const { data, error } = await getSupabase().from("students").select("programme").eq("id", studentRowId).maybeSingle();
  if (error) throw new Error(`studentProgramme failed: ${error.message}`);
  if (!data) throw new Error("Student not found.");
  return data.programme as string;
}

/** Published assignments for the student's programme, with their own submission and grade. */
export async function listAssignmentsForStudent(studentRowId: string) {
  const programme = await studentProgramme(studentRowId);
  const supabase = getSupabase();
  const { data: items, error } = await supabase.from("assignments")
    .select("id, title, course_code, due_at").eq("status", "published").ilike("programme", programme)
    .order("due_at", { ascending: true }).limit(200);
  if (error) throw new Error(`listAssignmentsForStudent failed: ${error.message}`);
  const { data: mine } = await supabase.from("assignment_submissions")
    .select("assignment_id, submitted_at, score, feedback").eq("student_row_id", studentRowId);
  const byAssignment = new Map<string, { submitted_at: string; score: number | null; feedback: string | null }>();
  for (const m of mine || []) byAssignment.set(m.assignment_id as string, { submitted_at: m.submitted_at as string, score: m.score as number | null, feedback: m.feedback as string | null });
  return (items || []).map((a) => {
    const sub = byAssignment.get(a.id as string);
    return { ...a, open: isOpen(a.due_at as string), submitted: !!sub, submittedAt: sub?.submitted_at ?? null, score: sub?.score ?? null, feedback: sub?.feedback ?? null };
  });
}

/** Accepts one written answer, before the due date, and only once. */
export async function submitAssignment(studentRowId: string, assignmentId: string, body: unknown) {
  const text = typeof body === "string" ? body : "";
  const problem = validateSubmission(text);
  if (problem) throw new Error(problem);
  const programme = await studentProgramme(studentRowId);
  const supabase = getSupabase();
  const { data: a, error } = await supabase.from("assignments").select("id, programme, due_at, status")
    .eq("id", assignmentId).maybeSingle();
  if (error) throw new Error(`submitAssignment failed: ${error.message}`);
  if (!a || a.status !== "published" || (a.programme as string).toLowerCase() !== programme.toLowerCase()) {
    throw new Error("That assignment was not found.");
  }
  if (!isOpen(a.due_at as string)) throw new Error("The due date has passed, so this assignment can no longer be submitted.");

  const { error: insertError } = await supabase.from("assignment_submissions").insert({
    assignment_id: assignmentId, student_row_id: studentRowId, body: text.trim(),
  });
  if (insertError) {
    if (insertError.code === "23505") throw new DuplicateRequestError("You have already submitted this assignment.");
    throw new Error(`submitAssignment failed: ${insertError.message}`);
  }
  return { success: true };
}
