/** Assignment rules. No database or network imports, so they can be tested directly. */
export const MAX_SUBMISSION_CHARS = 5000;
export const MAX_FEEDBACK_CHARS = 2000;

export interface AssignmentInput { title: string; instructions: string; programme: string; courseCode?: string; dueAt: string }

export function validateAssignment(a: AssignmentInput, now: Date = new Date()): string | null {
  if (a.title.trim().length < 3 || a.title.trim().length > 160) return "The title must be 3 to 160 characters.";
  if (a.instructions.trim().length < 10 || a.instructions.trim().length > 4000) return "Instructions must be 10 to 4000 characters.";
  if (a.programme.trim().length < 2) return "Choose the programme.";
  if ((a.courseCode || "").length > 20) return "The course code is too long.";
  const due = new Date(a.dueAt);
  if (Number.isNaN(due.getTime())) return "Choose a valid due date.";
  if (due.getTime() <= now.getTime()) return "The due date must be in the future.";
  return null;
}

export function validateSubmission(body: string): string | null {
  const t = body.trim();
  if (t.length < 1) return "Write your answer before you submit.";
  if (t.length > MAX_SUBMISSION_CHARS) return `Keep your answer under ${MAX_SUBMISSION_CHARS} characters.`;
  return null;
}

/** A submission is accepted only before the due date. */
export function isOpen(dueAt: string, now: Date = new Date()): boolean {
  return new Date(dueAt).getTime() > now.getTime();
}

export function validateGrade(score: unknown, feedback: unknown): string | null {
  if (!Number.isInteger(score) || (score as number) < 0 || (score as number) > 100) return "The score must be a whole number from 0 to 100.";
  if (typeof feedback === "string" && feedback.length > MAX_FEEDBACK_CHARS) return `Keep the feedback under ${MAX_FEEDBACK_CHARS} characters.`;
  return null;
}
