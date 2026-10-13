import { Router, Request, Response } from "express";
import { requireStaffAuth, StaffRequest } from "../middleware/staffAuth.js";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { canTeach } from "../services/staffValidation.js";
import { createAssignment, publishAssignment, listOwnAssignments, listSubmissions, gradeSubmission, listAssignmentsForStudent, submitAssignment } from "../services/assignmentService.js";

function requireTeacher(req: Request, res: Response, next: () => void) {
  const staff = (req as StaffRequest).staff;
  if (!staff) return res.status(401).json({ error: "Sign in with your own staff account." });
  if (!canTeach(staff.role)) return res.status(403).json({ error: "Only lecturers and administrators can set assignments." });
  return next();
}

function teacherOf(req: Request) {
  const staff = (req as StaffRequest).staff!;
  return { id: staff.id, fullName: staff.fullName };
}

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  const status = (err as Error).name === "DuplicateRequestError" ? 409 : /not found/i.test(message) ? 404 : 400;
  res.status(status).json({ error: message });
}

export const staffAssignmentRouter = Router();
staffAssignmentRouter.use(requireStaffAuth, requireTeacher);

staffAssignmentRouter.get("/", async (req: Request, res: Response) => {
  try { res.json({ assignments: await listOwnAssignments(teacherOf(req)) }); }
  catch (err) { fail(res, err, "Could not load assignments."); }
});

staffAssignmentRouter.post("/", async (req: Request, res: Response) => {
  try { res.json({ success: true, assignment: await createAssignment(teacherOf(req), req.body) }); }
  catch (err) { fail(res, err, "Could not create the assignment."); }
});

staffAssignmentRouter.post("/:id/publish", async (req: Request, res: Response) => {
  try { res.json(await publishAssignment(teacherOf(req), req.params.id)); }
  catch (err) { fail(res, err, "Could not publish the assignment."); }
});

staffAssignmentRouter.get("/:id/submissions", async (req: Request, res: Response) => {
  try { res.json({ submissions: await listSubmissions(teacherOf(req), req.params.id) }); }
  catch (err) { fail(res, err, "Could not load the submissions."); }
});

staffAssignmentRouter.post("/submissions/:submissionId/grade", async (req: Request, res: Response) => {
  try {
    const { score, feedback } = req.body as { score?: unknown; feedback?: unknown };
    res.json(await gradeSubmission(teacherOf(req), req.params.submissionId, score, feedback));
  } catch (err) { fail(res, err, "Could not save the grade."); }
});

export const studentAssignmentRouter = Router();
studentAssignmentRouter.use(requireStudentAuth);

studentAssignmentRouter.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try { res.json({ assignments: await listAssignmentsForStudent(req.studentRowId as string) }); }
  catch (err) { fail(res, err, "Could not load assignments."); }
});

studentAssignmentRouter.post("/:id/submit", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { body } = req.body as { body?: unknown };
    res.json(await submitAssignment(req.studentRowId as string, req.params.id, body));
  } catch (err) { fail(res, err, "Could not submit the assignment."); }
});
