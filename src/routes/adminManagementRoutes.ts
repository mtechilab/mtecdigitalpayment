import { Router, Request, Response } from "express";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";
import {
  updateStudent, deleteStudent, listProgrammes, addProgramme, updateProgramme, setProgrammeActive, listFees, setFee, deleteProgramme,
} from "../services/adminManagementService.js";

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
}

export const adminManagementRouter = Router();
adminManagementRouter.use(requireAdminAuth);

const actor = (req: AdminRequest) => req.adminUsername || "admin";

adminManagementRouter.post("/students/:id/update", async (req: AdminRequest, res: Response) => {
  try { res.json(await updateStudent(actor(req), req.params.id, (req.body || {}) as Record<string, string>)); }
  catch (err) { fail(res, err, "Could not update the student."); }
});

adminManagementRouter.post("/students/:id/status", async (req: AdminRequest, res: Response) => {
  try {
    const { status } = (req.body || {}) as { status?: string };
    res.json(await updateStudent(actor(req), req.params.id, { status: status as string }));
  } catch (err) { fail(res, err, "Could not change the student's status."); }
});

adminManagementRouter.post("/students/:id/delete", async (req: AdminRequest, res: Response) => {
  try { res.json(await deleteStudent(actor(req), req.params.id)); }
  catch (err) { fail(res, err, "Could not delete the student."); }
});

adminManagementRouter.get("/programmes", async (_req: AdminRequest, res: Response) => {
  try { res.json({ programmes: await listProgrammes() }); }
  catch (err) { fail(res, err, "Could not load the programmes."); }
});

adminManagementRouter.post("/programmes", async (req: AdminRequest, res: Response) => {
  try { res.json(await addProgramme(actor(req), req.body || {})); }
  catch (err) { fail(res, err, "Could not add the programme."); }
});

adminManagementRouter.post("/programmes/:id/update", async (req: AdminRequest, res: Response) => {
  try { res.json(await updateProgramme(actor(req), req.params.id, req.body || {})); }
  catch (err) { fail(res, err, "Could not update the programme."); }
});

adminManagementRouter.post("/programmes/:id/delete", async (req: AdminRequest, res: Response) => {
  try { res.json(await deleteProgramme(actor(req), req.params.id)); }
  catch (err) { fail(res, err, "Could not delete the programme."); }
});

adminManagementRouter.post("/programmes/:id/active", async (req: AdminRequest, res: Response) => {
  try {
    const { active } = (req.body || {}) as { active?: boolean };
    if (typeof active !== "boolean") return res.status(400).json({ error: "active must be true or false." });
    res.json(await setProgrammeActive(actor(req), req.params.id, active));
  } catch (err) { fail(res, err, "Could not change the programme."); }
});

adminManagementRouter.get("/fees", async (_req: AdminRequest, res: Response) => {
  try { res.json({ fees: await listFees() }); }
  catch (err) { fail(res, err, "Could not load the fees."); }
});

adminManagementRouter.post("/fees", async (req: AdminRequest, res: Response) => {
  try {
    const { programme, registrationFee, tuitionPerSemester } = (req.body || {}) as Record<string, unknown>;
    if (typeof programme !== "string") return res.status(400).json({ error: "Choose a programme." });
    res.json(await setFee(actor(req), programme, registrationFee, tuitionPerSemester));
  } catch (err) { fail(res, err, "Could not update the fee."); }
});
