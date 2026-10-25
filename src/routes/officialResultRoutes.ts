import { Router, Request, Response } from "express";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { uploadOfficialSlip, listSlips, slipLink, removeSlip, restoreSlip, setBatchPublished } from "../services/officialResultService.js";

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
}

export const adminResultsRouter = Router();
adminResultsRouter.use(requireAdminAuth);

adminResultsRouter.post("/slips", async (req: AdminRequest, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, string>;
    res.json(await uploadOfficialSlip(req.adminUsername || "admin", {
      studentRowId: b.studentRowId, semester: b.semester, academicYear: b.academicYear,
      contentType: b.contentType, fileBase64: b.fileBase64,
    }));
  } catch (err) { fail(res, err, "The copy could not be uploaded."); }
});

adminResultsRouter.get("/slips", async (req: AdminRequest, res: Response) => {
  try {
    const studentRowId = typeof req.query.studentRowId === "string" ? req.query.studentRowId : "";
    if (!studentRowId) return res.status(400).json({ error: "Choose a student." });
    res.json({ slips: await listSlips(studentRowId, true) });
  } catch (err) { fail(res, err, "Could not load the copies."); }
});

adminResultsRouter.get("/slips/:id/link", async (req: AdminRequest, res: Response) => {
  try { res.json(await slipLink(req.params.id, { admin: true })); }
  catch (err) { fail(res, err, "Could not open the copy."); }
});

adminResultsRouter.post("/slips/:id/remove", async (req: AdminRequest, res: Response) => {
  try { res.json(await removeSlip(req.adminUsername || "admin", req.params.id, (req.body || {}).reason)); }
  catch (err) { fail(res, err, "Could not remove the copy."); }
});

adminResultsRouter.post("/slips/:id/restore", async (req: AdminRequest, res: Response) => {
  try { res.json(await restoreSlip(req.adminUsername || "admin", req.params.id, (req.body || {}).reason)); }
  catch (err) { fail(res, err, "Could not restore the copy."); }
});

adminResultsRouter.post("/batches/:classId/publish", async (req: AdminRequest, res: Response) => {
  try { res.json(await setBatchPublished(req.adminUsername || "admin", req.params.classId, true, (req.body || {}).reason)); }
  catch (err) { fail(res, err, "Could not publish the results."); }
});

adminResultsRouter.post("/batches/:classId/unpublish", async (req: AdminRequest, res: Response) => {
  try { res.json(await setBatchPublished(req.adminUsername || "admin", req.params.classId, false, (req.body || {}).reason)); }
  catch (err) { fail(res, err, "Could not unpublish the results."); }
});

/** Students: their own official copies that are still on the statement. No Word files. */
export const studentResultsRouter = Router();
studentResultsRouter.use(requireStudentAuth);

studentResultsRouter.get("/slips", async (req: Request, res: Response) => {
  try { res.json({ slips: await listSlips((req as AuthenticatedRequest).studentRowId as string, false) }); }
  catch (err) { fail(res, err, "Could not load your copies."); }
});

studentResultsRouter.get("/slips/:id/link", async (req: Request, res: Response) => {
  try { res.json(await slipLink(req.params.id, { studentRowId: (req as AuthenticatedRequest).studentRowId as string })); }
  catch (err) { fail(res, err, "Could not open the copy."); }
});
