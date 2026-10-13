import { Router, Request, Response } from "express";
import { requireStaffAuth, StaffRequest } from "../middleware/staffAuth.js";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { canTeach } from "../services/staffValidation.js";
import { createQuiz, publishQuiz, listOwnQuizzes, quizResults, listQuizzesForStudent, getQuizForStudent, submitQuizAttempt } from "../services/quizService.js";

function requireTeacher(req: Request, res: Response, next: () => void) {
  const staff = (req as StaffRequest).staff;
  if (!staff) return res.status(401).json({ error: "Sign in with your own staff account." });
  if (!canTeach(staff.role)) return res.status(403).json({ error: "Only lecturers and administrators can write quizzes." });
  return next();
}

function teacherOf(req: Request) {
  const staff = (req as StaffRequest).staff!;
  return { id: staff.id, fullName: staff.fullName };
}

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  const name = (err as Error).name;
  const status = name === "DuplicateRequestError" ? 409 : /not found/i.test(message) ? 404 : 400;
  res.status(status).json({ error: message });
}

export const staffQuizRouter = Router();
staffQuizRouter.use(requireStaffAuth, requireTeacher);

staffQuizRouter.get("/", async (req: Request, res: Response) => {
  try { res.json({ quizzes: await listOwnQuizzes(teacherOf(req)) }); }
  catch (err) { fail(res, err, "Could not load quizzes."); }
});

staffQuizRouter.post("/", async (req: Request, res: Response) => {
  try { res.json({ success: true, quiz: await createQuiz(teacherOf(req), req.body) }); }
  catch (err) { fail(res, err, "Could not create the quiz."); }
});

staffQuizRouter.post("/:id/publish", async (req: Request, res: Response) => {
  try { res.json(await publishQuiz(teacherOf(req), req.params.id)); }
  catch (err) { fail(res, err, "Could not publish the quiz."); }
});

staffQuizRouter.get("/:id/results", async (req: Request, res: Response) => {
  try { res.json({ results: await quizResults(teacherOf(req), req.params.id) }); }
  catch (err) { fail(res, err, "Could not load the results."); }
});

export const studentQuizRouter = Router();
studentQuizRouter.use(requireStudentAuth);

studentQuizRouter.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try { res.json({ quizzes: await listQuizzesForStudent(req.studentRowId as string) }); }
  catch (err) { fail(res, err, "Could not load quizzes."); }
});

studentQuizRouter.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try { res.json(await getQuizForStudent(req.studentRowId as string, req.params.id)); }
  catch (err) { fail(res, err, "Could not open the quiz."); }
});

studentQuizRouter.post("/:id/submit", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { answers } = req.body as { answers?: unknown };
    res.json(await submitQuizAttempt(req.studentRowId as string, req.params.id, answers));
  } catch (err) { fail(res, err, "Could not submit the quiz."); }
});
