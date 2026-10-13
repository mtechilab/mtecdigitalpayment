import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { DuplicateRequestError } from "./errors.js";
import { validateQuiz, validateAnswers, countCorrect, QuizInput } from "./quizPolicy.js";

export interface Teacher { id: string; fullName: string }

/** Only the lecturer or administrator who wrote a quiz can change or read its results. */
async function ownQuiz(owner: Teacher, quizId: string) {
  const { data, error } = await getSupabase().from("quizzes").select("*").eq("id", quizId).maybeSingle();
  if (error) throw new Error(`ownQuiz failed: ${error.message}`);
  if (!data || data.owner_staff_id !== owner.id) throw new Error("That quiz was not found.");
  return data;
}

export async function createQuiz(owner: Teacher, input: QuizInput) {
  const problem = validateQuiz(input);
  if (problem) throw new Error(problem);
  const supabase = getSupabase();
  const { data: quiz, error } = await supabase.from("quizzes").insert({
    owner_staff_id: owner.id, owner_name: owner.fullName, title: input.title.trim(),
    programme: input.programme.trim(), course_code: (input.courseCode || "").trim(), status: "draft",
  }).select("id").single();
  if (error) throw new Error(`createQuiz failed: ${error.message}`);

  const rows = input.questions.map((q, i) => ({
    quiz_id: quiz.id as string, position: i + 1, question: q.question.trim(),
    options: q.options.map((o) => o.trim()), correct_index: q.correctIndex,
  }));
  const { error: qError } = await supabase.from("quiz_questions").insert(rows);
  if (qError) {
    await supabase.from("quizzes").delete().eq("id", quiz.id as string); // no half-made quizzes
    throw new Error(`createQuiz (questions) failed: ${qError.message}`);
  }
  return { id: quiz.id as string, status: "draft", questions: rows.length };
}

export async function publishQuiz(owner: Teacher, quizId: string) {
  const quiz = await ownQuiz(owner, quizId);
  if (quiz.status === "published") return { success: true };
  const { error } = await getSupabase().from("quizzes")
    .update({ status: "published", published_at: new Date().toISOString() }).eq("id", quizId);
  if (error) throw new Error(`publishQuiz failed: ${error.message}`);
  await recordAudit({ actor: owner.fullName, action: "quiz.publish", entityType: "quiz", entityId: quizId, detail: { programme: quiz.programme } });
  return { success: true };
}

export async function listOwnQuizzes(owner: Teacher) {
  const { data, error } = await getSupabase().from("quizzes")
    .select("id, title, programme, course_code, status, published_at, created_at")
    .eq("owner_staff_id", owner.id).order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(`listOwnQuizzes failed: ${error.message}`);
  return data || [];
}

/** Scores and names for one quiz, for the lecturer who wrote it. */
export async function quizResults(owner: Teacher, quizId: string) {
  await ownQuiz(owner, quizId);
  const supabase = getSupabase();
  const { data: attempts, error } = await supabase.from("quiz_attempts")
    .select("student_row_id, score, total, submitted_at").eq("quiz_id", quizId).order("submitted_at", { ascending: false });
  if (error) throw new Error(`quizResults failed: ${error.message}`);
  const ids = (attempts || []).map((a) => a.student_row_id as string);
  const names = new Map<string, { student_id: string; full_name: string }>();
  if (ids.length > 0) {
    const { data: students, error: sErr } = await supabase.from("students").select("id, student_id, full_name").in("id", ids);
    if (sErr) throw new Error(`quizResults (students) failed: ${sErr.message}`);
    for (const s of students || []) names.set(s.id as string, { student_id: s.student_id as string, full_name: s.full_name as string });
  }
  return (attempts || []).map((a) => ({
    studentId: names.get(a.student_row_id as string)?.student_id || "",
    studentName: names.get(a.student_row_id as string)?.full_name || "",
    score: a.score, total: a.total, submittedAt: a.submitted_at,
  }));
}

async function studentProgramme(studentRowId: string): Promise<string> {
  const { data, error } = await getSupabase().from("students").select("programme").eq("id", studentRowId).maybeSingle();
  if (error) throw new Error(`studentProgramme failed: ${error.message}`);
  if (!data) throw new Error("Student not found.");
  return data.programme as string;
}

/** Published quizzes for the student's own programme, with whether they have attempted each. */
export async function listQuizzesForStudent(studentRowId: string) {
  const programme = await studentProgramme(studentRowId);
  const supabase = getSupabase();
  const { data: quizzes, error } = await supabase.from("quizzes")
    .select("id, title, course_code, published_at").eq("status", "published").ilike("programme", programme)
    .order("published_at", { ascending: false }).limit(200);
  if (error) throw new Error(`listQuizzesForStudent failed: ${error.message}`);
  const { data: mine } = await supabase.from("quiz_attempts").select("quiz_id, score, total").eq("student_row_id", studentRowId);
  const taken = new Map<string, { score: number; total: number }>();
  for (const a of mine || []) taken.set(a.quiz_id as string, { score: a.score as number, total: a.total as number });
  return (quizzes || []).map((q) => {
    const a = taken.get(q.id as string);
    return { ...q, attempted: !!a, score: a?.score ?? null, total: a?.total ?? null };
  });
}

/** The questions and options, without the correct answers. */
export async function getQuizForStudent(studentRowId: string, quizId: string) {
  const programme = await studentProgramme(studentRowId);
  const supabase = getSupabase();
  const { data: quiz, error } = await supabase.from("quizzes").select("id, title, programme, status")
    .eq("id", quizId).maybeSingle();
  if (error) throw new Error(`getQuizForStudent failed: ${error.message}`);
  if (!quiz || quiz.status !== "published" || (quiz.programme as string).toLowerCase() !== programme.toLowerCase()) {
    throw new Error("That quiz was not found.");
  }
  const { data: questions, error: qError } = await supabase.from("quiz_questions")
    .select("position, question, options").eq("quiz_id", quizId).order("position", { ascending: true });
  if (qError) throw new Error(`getQuizForStudent (questions) failed: ${qError.message}`);
  return { id: quiz.id, title: quiz.title, questions: (questions || []).map((q) => ({ position: q.position, question: q.question, options: q.options })) };
}

/** Scores an attempt on the server and records it once. A second submission is refused. */
export async function submitQuizAttempt(studentRowId: string, quizId: string, answers: unknown) {
  const quiz = await getQuizForStudent(studentRowId, quizId);
  const supabase = getSupabase();
  const { data: questions, error } = await supabase.from("quiz_questions")
    .select("position, options, correct_index").eq("quiz_id", quizId).order("position", { ascending: true });
  if (error) throw new Error(`submitQuizAttempt (questions) failed: ${error.message}`);
  const rows = questions || [];
  const problem = validateAnswers(answers, rows.map((q) => (q.options as unknown[]).length));
  if (problem) throw new Error(problem);

  const { data: already } = await supabase.from("quiz_attempts").select("id")
    .eq("quiz_id", quizId).eq("student_row_id", studentRowId).maybeSingle();
  if (already) throw new DuplicateRequestError("You have already submitted this quiz.");

  const given = answers as number[];
  const correct = rows.map((q) => q.correct_index as number);
  const score = countCorrect(correct, given);
  const { error: insertError } = await supabase.from("quiz_attempts").insert({
    quiz_id: quizId, student_row_id: studentRowId, score, total: rows.length, answers: given,
  });
  if (insertError) {
    if (insertError.code === "23505") throw new DuplicateRequestError("You have already submitted this quiz.");
    throw new Error(`submitQuizAttempt failed: ${insertError.message}`);
  }
  // Show the correct answers only now, after the attempt is recorded.
  return { title: quiz.title, score, total: rows.length, review: correct.map((c, i) => ({ position: i + 1, correctIndex: c, yourIndex: given[i] })) };
}
