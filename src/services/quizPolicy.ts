/** Quiz rules. No database or network imports, so they can be tested directly. */
export interface QuestionInput { question: string; options: string[]; correctIndex: number }
export interface QuizInput { title: string; programme: string; courseCode?: string; questions: QuestionInput[] }

export const MAX_QUESTIONS = 30;

/** The first problem with a quiz, or null when it is valid. */
export function validateQuiz(q: QuizInput): string | null {
  if (q.title.trim().length < 3 || q.title.trim().length > 160) return "The title must be 3 to 160 characters.";
  if (q.programme.trim().length < 2 || q.programme.trim().length > 120) return "Choose the programme.";
  if ((q.courseCode || "").length > 20) return "The course code is too long.";
  if (!Array.isArray(q.questions) || q.questions.length < 1) return "Add at least one question.";
  if (q.questions.length > MAX_QUESTIONS) return `A quiz can have at most ${MAX_QUESTIONS} questions.`;
  for (let i = 0; i < q.questions.length; i++) {
    const item = q.questions[i];
    const n = i + 1;
    if (item.question.trim().length < 5 || item.question.trim().length > 500) return `Question ${n} must be 5 to 500 characters.`;
    if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 6) return `Question ${n} needs 2 to 6 options.`;
    if (item.options.some((o) => o.trim().length < 1 || o.trim().length > 200)) return `Each option in question ${n} must be 1 to 200 characters.`;
    if (!Number.isInteger(item.correctIndex) || item.correctIndex < 0 || item.correctIndex >= item.options.length) {
      return `Mark the correct answer for question ${n}.`;
    }
  }
  return null;
}

/** Checks a student's answers: one per question, each a valid option number. */
export function validateAnswers(answers: unknown, optionCounts: number[]): string | null {
  if (!Array.isArray(answers) || answers.length !== optionCounts.length) {
    return "Answer every question before you submit.";
  }
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (!Number.isInteger(a) || (a as number) < 0 || (a as number) >= optionCounts[i]) {
      return `Question ${i + 1} has an answer that is not one of its options.`;
    }
  }
  return null;
}

/** How many answers match the correct ones. */
export function countCorrect(correct: number[], answers: number[]): number {
  let score = 0;
  for (let i = 0; i < correct.length; i++) if (answers[i] === correct[i]) score++;
  return score;
}
