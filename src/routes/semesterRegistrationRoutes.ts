import { Router, Request, Response } from "express";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  studentSemesterStatus, submitSemesterPayment, setWindow, listPendingRegistrations, reviewSemesterPayment,
  assignCourses, registrationReceiptLink, listWindows,
} from "../services/semesterRegistrationService.js";

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
}

export const studentSemesterRouter = Router();
studentSemesterRouter.use(requireStudentAuth);

studentSemesterRouter.get("/status", async (req: Request, res: Response) => {
  try {
    const { semester, year } = req.query as { semester?: string; year?: string };
    if (!semester || !year) return res.status(400).json({ error: "Choose a semester and academic year." });
    res.json(await studentSemesterStatus((req as AuthenticatedRequest).studentRowId as string, semester, year));
  } catch (err) { fail(res, err, "Could not load registration."); }
});

studentSemesterRouter.post("/pay", rateLimit("semester-pay", 10, 60 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    if (typeof b.semester !== "string" || typeof b.year !== "string") return res.status(400).json({ error: "Choose a semester and academic year." });
    res.json(await submitSemesterPayment((req as AuthenticatedRequest).studentRowId as string, b.semester, b.year, {
      method: b.method, reference: b.reference, receiptBase64: b.receiptBase64, receiptContentType: b.receiptContentType,
    }));
  } catch (err) { fail(res, err, "Could not record your payment."); }
});

export const adminSemesterRouter = Router();
adminSemesterRouter.use(requireAdminAuth);

adminSemesterRouter.post("/window", async (req: AdminRequest, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    res.json(await setWindow(req.adminUsername || "admin", {
      semester: String(b.semester || ""), academicYear: String(b.academicYear || ""),
      opensAt: String(b.opensAt || ""), closesAt: String(b.closesAt || ""),
      lateClosesAt: typeof b.lateClosesAt === "string" && b.lateClosesAt ? b.lateClosesAt : null,
      surchargePercent: Number(b.surchargePercent ?? 50), isOpen: b.isOpen !== false,
    }));
  } catch (err) { fail(res, err, "Could not save the registration window."); }
});

adminSemesterRouter.get("/pending", async (req: AdminRequest, res: Response) => {
  try {
    const { semester, year } = req.query as { semester?: string; year?: string };
    if (!semester || !year) return res.status(400).json({ error: "Choose a semester and academic year." });
    res.json({ registrations: await listPendingRegistrations(semester, year) });
  } catch (err) { fail(res, err, "Could not load registrations."); }
});

adminSemesterRouter.get("/registrations/:id/receipt", async (req: AdminRequest, res: Response) => {
  try { res.json(await registrationReceiptLink(req.params.id)); }
  catch (err) { fail(res, err, "Could not open the receipt."); }
});

adminSemesterRouter.post("/registrations/:id/review", async (req: AdminRequest, res: Response) => {
  try {
    const { decision, reason } = (req.body || {}) as { decision?: unknown; reason?: unknown };
    res.json(await reviewSemesterPayment(req.adminUsername || "admin", req.params.id, decision, reason));
  } catch (err) { fail(res, err, "Could not review the payment."); }
});

adminSemesterRouter.post("/students/:id/courses", async (req: AdminRequest, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    res.json(await assignCourses(req.adminUsername || "admin", req.params.id, String(b.semester || ""), String(b.year || ""), b.courses));
  } catch (err) { fail(res, err, "Could not assign the courses."); }
});

studentSemesterRouter.get("/windows", async (_req: Request, res: Response) => {
  try { res.json({ windows: await listWindows() }); }
  catch (err) { fail(res, err, "Could not load the semesters."); }
});

adminSemesterRouter.get("/windows", async (_req: AdminRequest, res: Response) => {
  try { res.json({ windows: await listWindows() }); }
  catch (err) { fail(res, err, "Could not load the semesters."); }
});
