import { recordAudit } from "../services/auditLogService.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { loginStaff } from "../services/staffAccountService.js";
import { Router, Request, Response } from "express";
import { requireStaffAuth, StaffRequest } from "../middleware/staffAuth.js";
import {
  getPendingCashSubmissions,
  finalizeVerifiedPayment,
  rejectSubmission,
} from "../services/paymentPlanService.js";

const router = Router();
// Public: a staff member signs in with their own account. Rate-limited like the other logins.
router.post("/login", rateLimit("staff-login", 10, 15 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) return res.status(400).json({ error: "Username and password are required." });
    const session = await loginStaff(username, password);
    if (!session) return res.status(401).json({ error: "Wrong username or password." });
    res.json({ token: session.token, staff: session.staff });
  } catch (err) {
    console.error("[/staff/login] error:", (err as Error).message);
    res.status(500).json({ error: "Could not sign in. Please try again." });
  }
});

router.use(requireStaffAuth);

// GET /staff/cash-submissions — everything currently awaiting approval.
router.get("/cash-submissions", async (_req: Request, res: Response) => {
  try {
    const submissions = await getPendingCashSubmissions();
    res.json({ submissions });
  } catch (err) {
    console.error("[/staff/cash-submissions] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load pending submissions." });
  }
});

// POST /staff/cash-submissions/:id/approve — { staffName }
// Reuses the exact same finalizeVerifiedPayment the Monime webhook uses,
// so the payment plan / dashboard update the same way regardless of method.
router.post("/cash-submissions/:id/approve", async (req: Request, res: Response) => {
  try {
    // An individual account names the approver itself. The legacy key must still send a name.
    const staff = (req as StaffRequest).staff;
    const approver = staff ? staff.fullName : (req.body as { staffName?: string }).staffName;
    if (!approver) return res.status(400).json({ error: "staffName is required." });
    const result = await finalizeVerifiedPayment(req.params.id, `Cash (confirmed by ${approver})`);
    await recordAudit({ actor: staff ? staff.username : approver, action: "payment.verify",
      entityType: "payment_submission", entityId: req.params.id, detail: { via: staff ? "staff_account" : "shared_key" } });
    res.json({ success: true, alreadyProcessed: (result as any)?.alreadyProcessed === true });
  } catch (err) {
    console.error("[/staff/cash-submissions/approve] error:", (err as Error).message);
    res.status(500).json({ error: "Could not approve payment." });
  }
});

// POST /staff/cash-submissions/:id/reject — { reason }
router.post("/cash-submissions/:id/reject", async (req: Request, res: Response) => {
  try {
    const { reason } = req.body as { reason?: string };
    if (!reason) return res.status(400).json({ error: "reason is required." });
    await rejectSubmission(req.params.id, reason);
    res.json({ success: true });
  } catch (err) {
    console.error("[/staff/cash-submissions/reject] error:", (err as Error).message);
    res.status(500).json({ error: "Could not reject payment." });
  }
});

export default router;
