import { Router, Request, Response } from "express";
import { loginAdmin, setupFirstAdmin, changeAdminPassword } from "../services/adminAuthService.js";
import { getDashboardSummary } from "../services/adminDashboardService.js";
import { listApplications, getApplication, approveApplication, rejectApplication } from "../services/adminApplicationsService.js";
import { getPendingSubmissions, finalizeVerifiedPayment, rejectSubmission } from "../services/paymentPlanService.js";
import { listStudents, getStudentDetail } from "../services/adminStudentsService.js";
import { listTransactions } from "../services/adminTransactionsService.js";
import { listFeeStructures } from "../services/adminFeeStructuresService.js";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";

const router = Router();

// POST /admin/setup — { username, password, fullName }
// Only works while admin_accounts is empty. This is how the very first
// admin account gets created; it refuses once one already exists.
router.post("/setup", async (req: Request, res: Response) => {
  const { username, password, fullName } = req.body as { username?: string; password?: string; fullName?: string };
  if (!username || !password || !fullName) {
    return res.status(400).json({ error: "username, password, and fullName are all required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const result = await setupFirstAdmin(username, password, fullName);
  if (!result.success) return res.status(403).json({ error: result.reason });
  res.json({ success: true });
});

// POST /admin/login — { username, password }
router.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) return res.status(400).json({ error: "username and password are required." });

  const result = await loginAdmin(username, password);
  if (result.outcome === "no_admin_configured") {
    return res.status(409).json({ error: "no_admin_configured", message: "No admin account exists yet — use /admin/setup first." });
  }
  if (result.outcome === "invalid_credentials") {
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  res.json({ token: result.token, fullName: result.fullName, role: result.role });
});

// Everything below here requires a valid admin session.
router.use(requireAdminAuth);

router.get("/dashboard", async (_req: AdminRequest, res: Response) => {
  try {
    const summary = await getDashboardSummary();
    res.json(summary);
  } catch (err) {
    console.error("[/admin/dashboard] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load dashboard." });
  }
});

// GET /admin/applications?status=submitted
router.get("/applications", async (req: AdminRequest, res: Response) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const applications = await listApplications(status);
    res.json({ applications });
  } catch (err) {
    console.error("[/admin/applications] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load applications." });
  }
});

// GET /admin/applications/:id
router.get("/applications/:id", async (req: AdminRequest, res: Response) => {
  try {
    const application = await getApplication(req.params.id);
    if (!application) return res.status(404).json({ error: "Application not found." });
    res.json(application);
  } catch (err) {
    console.error("[/admin/applications/:id] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load application." });
  }
});

// POST /admin/applications/:id/approve
router.post("/applications/:id/approve", async (req: AdminRequest, res: Response) => {
  try {
    const result = await approveApplication(req.params.id);
    if (result.outcome === "not_found") return res.status(404).json({ error: "Application not found." });
    if (result.outcome === "already_processed") {
      return res.status(409).json({ error: `Application is already ${result.status}.` });
    }
    res.json({ success: true, studentId: result.studentId, pin: result.pin });
  } catch (err) {
    console.error("[/admin/applications/:id/approve] error:", (err as Error).message);
    res.status(500).json({ error: "Could not approve application." });
  }
});

// POST /admin/applications/:id/reject — { reason }
router.post("/applications/:id/reject", async (req: AdminRequest, res: Response) => {
  try {
    const { reason } = req.body as { reason?: string };
    if (!reason) return res.status(400).json({ error: "reason is required." });
    await rejectApplication(req.params.id, reason);
    res.json({ success: true });
  } catch (err) {
    console.error("[/admin/applications/:id/reject] error:", (err as Error).message);
    res.status(500).json({ error: "Could not reject application." });
  }
});

// GET /admin/payments/pending — every manual-method submission awaiting review
router.get("/payments/pending", async (_req: AdminRequest, res: Response) => {
  try {
    const submissions = await getPendingSubmissions();
    res.json({ submissions });
  } catch (err) {
    console.error("[/admin/payments/pending] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load pending payments." });
  }
});

// POST /admin/payments/:id/verify — { adminName }
router.post("/payments/:id/verify", async (req: AdminRequest, res: Response) => {
  try {
    const verifiedBy = req.adminUsername || "admin";
    const result = await finalizeVerifiedPayment(req.params.id, verifiedBy);
    res.json({ success: true, alreadyProcessed: (result as any)?.alreadyProcessed === true });
  } catch (err) {
    console.error("[/admin/payments/:id/verify] error:", (err as Error).message);
    res.status(500).json({ error: "Could not verify payment." });
  }
});

// POST /admin/payments/:id/reject — { reason }
router.post("/payments/:id/reject", async (req: AdminRequest, res: Response) => {
  try {
    const { reason } = req.body as { reason?: string };
    if (!reason) return res.status(400).json({ error: "reason is required." });
    await rejectSubmission(req.params.id, reason);
    res.json({ success: true });
  } catch (err) {
    console.error("[/admin/payments/:id/reject] error:", (err as Error).message);
    res.status(500).json({ error: "Could not reject payment." });
  }
});

// GET /admin/students?search=...
router.get("/students", async (req: AdminRequest, res: Response) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const students = await listStudents(search);
    res.json({ students });
  } catch (err) {
    console.error("[/admin/students] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load students." });
  }
});

// GET /admin/students/:id
router.get("/students/:id", async (req: AdminRequest, res: Response) => {
  try {
    const student = await getStudentDetail(req.params.id);
    if (!student) return res.status(404).json({ error: "Student not found." });
    res.json(student);
  } catch (err) {
    console.error("[/admin/students/:id] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load student." });
  }
});

// GET /admin/transactions?status=&method=
router.get("/transactions", async (req: AdminRequest, res: Response) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const method = typeof req.query.method === "string" ? req.query.method : undefined;
    const transactions = await listTransactions(status, method);
    res.json({ transactions });
  } catch (err) {
    console.error("[/admin/transactions] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load transactions." });
  }
});

// GET /admin/fee-structures
router.get("/fee-structures", async (_req: AdminRequest, res: Response) => {
  try {
    const feeStructures = await listFeeStructures();
    res.json({ feeStructures });
  } catch (err) {
    console.error("[/admin/fee-structures] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load fee structures." });
  }
});

// POST /admin/change-password — { currentPassword, newPassword }
router.post("/change-password", async (req: AdminRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "currentPassword and a newPassword of at least 8 characters are required." });
    }
    const result = await changeAdminPassword(req.adminId!, currentPassword, newPassword);
    if (result.outcome === "incorrect_current_password") {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    if (result.outcome === "not_found") {
      return res.status(404).json({ error: "Admin account not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[/admin/change-password] error:", (err as Error).message);
    res.status(500).json({ error: "Could not change password." });
  }
});

export default router;
