import { Router, Request, Response } from "express";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";
import { buildStudentResultDocx, buildMasterGradesheetDocx, sendDocx } from "../services/resultDocxService.js";

function fail(res: Response, err: unknown) {
  const message = (err as Error).message || "The document could not be created.";
  res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
}

/** Admins: any student's result slip, and the master gradesheet for a programme, as Word files. */
export const adminDocsRouter = Router();
adminDocsRouter.use(requireAdminAuth);

adminDocsRouter.get("/students/:id/result-slip.docx", async (req: AdminRequest, res: Response) => {
  try {
    const { buffer, fileName } = await buildStudentResultDocx(req.params.id);
    sendDocx(res, buffer, fileName);
  } catch (err) { fail(res, err); }
});

adminDocsRouter.get("/gradesheet.docx", async (req: AdminRequest, res: Response) => {
  try {
    const programme = typeof req.query.programme === "string" ? req.query.programme.trim() : "";
    if (!programme) return res.status(400).json({ error: "Choose a programme." });
    const { buffer, fileName } = await buildMasterGradesheetDocx(programme);
    sendDocx(res, buffer, fileName);
  } catch (err) { fail(res, err); }
});
