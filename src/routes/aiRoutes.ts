import { Router, Request, Response } from "express";
import { requireStaffAuth, StaffRequest } from "../middleware/staffAuth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { createDraft, regenerateDraft, getDraft, listDrafts, saveDraft, approveDraft } from "../services/aiStudioService.js";

/** Lecturers only, with an individual staff session. */
function requireLecturer(req: Request, res: Response, next: () => void) {
  const staff = (req as StaffRequest).staff;
  if (!staff) return res.status(401).json({ error: "Sign in with your own staff account." });
  if (staff.role !== "lecturer") return res.status(403).json({ error: "Only lecturers can use the AI studio." });
  return next();
}

function lecturerOf(req: Request) {
  const staff = (req as StaffRequest).staff!;
  return { id: staff.id, fullName: staff.fullName };
}

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  const status = /not found/i.test(message) ? 404 : /cannot be changed|not configured|monthly limit/i.test(message) ? 409 : 400;
  res.status(status).json({ error: message });
}

export const aiStudioRouter = Router();
aiStudioRouter.use(requireStaffAuth, requireLecturer);

aiStudioRouter.get("/", async (req: Request, res: Response) => {
  try {
    res.json({ drafts: await listDrafts(lecturerOf(req)) });
  } catch (err) { fail(res, err, "Could not load drafts."); }
});

aiStudioRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    res.json({ draft: await getDraft(lecturerOf(req), req.params.id) });
  } catch (err) { fail(res, err, "Could not load the draft."); }
});

// Each generation is a paid call, so it is rate-limited per client as well as by the monthly budget.
aiStudioRouter.post("/", rateLimit("ai-generate", 20, 60 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const b = req.body as Record<string, string | undefined>;
    const draft = await createDraft(lecturerOf(req), {
      kind: b.kind || "", title: b.title || "", programme: b.programme || "",
      courseCode: b.courseCode, topic: b.topic, instructions: b.instructions,
    });
    res.json({ success: true, draft });
  } catch (err) { fail(res, err, "Could not generate the draft."); }
});

aiStudioRouter.post("/:id/regenerate", rateLimit("ai-generate", 20, 60 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const { instructions } = req.body as { instructions?: string };
    res.json({ success: true, draft: await regenerateDraft(lecturerOf(req), req.params.id, instructions || "") });
  } catch (err) { fail(res, err, "Could not regenerate the draft."); }
});

aiStudioRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const { content } = req.body as { content?: string };
    res.json(await saveDraft(lecturerOf(req), req.params.id, content || ""));
  } catch (err) { fail(res, err, "Could not save the draft."); }
});

aiStudioRouter.post("/:id/approve", async (req: Request, res: Response) => {
  try {
    res.json(await approveDraft(lecturerOf(req), req.params.id));
  } catch (err) { fail(res, err, "Could not approve the draft."); }
});
