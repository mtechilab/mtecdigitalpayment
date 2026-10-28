import { Router, Request, Response } from "express";
import { requireStaffAuth, StaffRequest } from "../middleware/staffAuth.js";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { createProject, updateProject, assignStudents, myProjects, saveCheckin, lecturerCheckins, checkinProjectOwnedBy, Actor } from "../services/projectService.js";
import { addAttachment, listAttachments, attachmentLink } from "../services/checkinAttachmentService.js";

function fail(res: Response, err: unknown) {
  const message = (err as Error).message || "The request could not be completed.";
  const status = /already submitted/i.test(message) ? 409 : /can only|not assigned/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 400;
  res.status(status).json({ error: message });
}

function staffActor(req: Request): Actor | null {
  const staff = (req as StaffRequest).staff;
  if (!staff) return null;
  if (staff.role === "administrator") return { kind: "admin", id: staff.id, name: staff.fullName };
  if (staff.role === "lecturer") return { kind: "lecturer", id: staff.id, name: staff.fullName };
  return null;
}

/** Administrators and lecturers, signed in with their staff accounts. */
export const staffProjectRouter = Router();
staffProjectRouter.use(requireStaffAuth);

staffProjectRouter.post("/", async (req: Request, res: Response) => {
  try {
    const actor = staffActor(req);
    if (!actor) return res.status(403).json({ error: "Only lecturers and administrators can create projects." });
    res.json(await createProject(actor, req.body || {}));
  } catch (err) { fail(res, err); }
});

staffProjectRouter.post("/:id/update", async (req: Request, res: Response) => {
  try {
    const actor = staffActor(req);
    if (!actor) return res.status(403).json({ error: "Only lecturers and administrators can change projects." });
    res.json(await updateProject(actor, req.params.id, req.body || {}));
  } catch (err) { fail(res, err); }
});

staffProjectRouter.post("/:id/students", async (req: Request, res: Response) => {
  try {
    const actor = staffActor(req);
    if (!actor) return res.status(403).json({ error: "Only lecturers and administrators can assign students." });
    res.json(await assignStudents(actor, req.params.id, (req.body || {}).studentRowIds || []));
  } catch (err) { fail(res, err); }
});

staffProjectRouter.get("/:id/checkins", async (req: Request, res: Response) => {
  try {
    const actor = staffActor(req);
    if (!actor) return res.status(403).json({ error: "Only lecturers and administrators can read check-ins." });
    res.json({ checkins: await lecturerCheckins(actor, req.params.id) });
  } catch (err) { fail(res, err); }
});

/** Students: their own projects, and saving their own weekly check-ins. */
export const studentProjectRouter = Router();
studentProjectRouter.use(requireStudentAuth);

studentProjectRouter.get("/mine", async (req: Request, res: Response) => {
  try { res.json({ projects: await myProjects((req as AuthenticatedRequest).studentRowId as string) }); }
  catch (err) { fail(res, err); }
});

studentProjectRouter.post("/checkins", async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    res.json(await saveCheckin((req as AuthenticatedRequest).studentRowId as string, {
      projectId: String(b.projectId || ""), week: Number(b.week), semester: String(b.semester || ""),
      workCompleted: b.workCompleted as string, skillsLearned: b.skillsLearned as string,
      challenges: b.challenges as string, nextPlan: b.nextPlan as string,
      submit: b.submit === true, clientReference: String(b.clientReference || ""),
    }));
  } catch (err) { fail(res, err); }
});

studentProjectRouter.post("/checkins/:id/attachments", async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    res.json(await addAttachment((req as AuthenticatedRequest).studentRowId as string, {
      checkinId: req.params.id, attachmentId: String(b.attachmentId || ""), contentType: b.contentType,
      fileBase64: b.fileBase64, fileName: typeof b.fileName === "string" ? b.fileName : "",
    }));
  } catch (err) { fail(res, err); }
});

studentProjectRouter.get("/checkins/:id/attachments", async (req: Request, res: Response) => {
  try {
    const owned = await listAttachments(req.params.id);
    res.json({ attachments: owned });
  } catch (err) { fail(res, err); }
});

studentProjectRouter.get("/attachments/:id/link", async (req: Request, res: Response) => {
  try { res.json(await attachmentLink(req.params.id, { studentRowId: (req as AuthenticatedRequest).studentRowId as string })); }
  catch (err) { fail(res, err); }
});

staffProjectRouter.get("/attachments/:id/link", async (req: Request, res: Response) => {
  try {
    const actor = staffActor(req);
    if (!actor) return res.status(403).json({ error: "Only lecturers and administrators can open evidence." });
    res.json(await attachmentLink(req.params.id, { canViewPath: (checkinId) => checkinProjectOwnedBy(actor, checkinId) }));
  } catch (err) { fail(res, err); }
});
