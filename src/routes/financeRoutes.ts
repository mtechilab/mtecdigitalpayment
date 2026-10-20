import { Router, Request, Response } from "express";
import { requireStaffAuth, StaffRequest } from "../middleware/staffAuth.js";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";
import { lookupStudent, recordCash, cashReceiptLink } from "../services/financeCashService.js";

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  res.status(/not found/i.test(message) ? 404 : /only finance|only administrators/i.test(message) ? 403 : 400).json({ error: message });
}

function cashBody(b: Record<string, unknown>) {
  return {
    studentId: String(b.studentId || ""), amount: b.amount, paymentType: String(b.paymentType || "Tuition Fees"),
    clientReference: b.clientReference, receiptBase64: b.receiptBase64, receiptContentType: b.receiptContentType,
  };
}

/** Finance officers, signed in with their own staff account. */
export const staffFinanceRouter = Router();
staffFinanceRouter.use(requireStaffAuth);
staffFinanceRouter.get("/students/lookup", async (req: Request, res: Response) => {
  try { res.json(await lookupStudent(String(req.query.studentId || ""))); }
  catch (err) { fail(res, err, "Could not find the student."); }
});
staffFinanceRouter.post("/cash", async (req: Request, res: Response) => {
  try {
    const staff = (req as StaffRequest).staff;
    if (!staff) return res.status(403).json({ error: "Sign in with your own staff account." });
    res.json(await recordCash(staff.fullName, staff.username, staff.role, cashBody((req.body || {}) as Record<string, unknown>)));
  } catch (err) { fail(res, err, "Could not record the payment."); }
});

/** Administrators record cash the same way. */
export const adminFinanceRouter = Router();
adminFinanceRouter.use(requireAdminAuth);
adminFinanceRouter.get("/students/lookup", async (req: AdminRequest, res: Response) => {
  try { res.json(await lookupStudent(String(req.query.studentId || ""))); }
  catch (err) { fail(res, err, "Could not find the student."); }
});
adminFinanceRouter.post("/cash", async (req: AdminRequest, res: Response) => {
  try {
    res.json(await recordCash(req.adminUsername || "admin", req.adminUsername || "admin", "administrator", cashBody((req.body || {}) as Record<string, unknown>)));
  } catch (err) { fail(res, err, "Could not record the payment."); }
});

adminFinanceRouter.get("/cash/:clientReference/receipt", async (req: AdminRequest, res: Response) => {
  try { res.json(await cashReceiptLink(req.params.clientReference)); }
  catch (err) { fail(res, err, "Could not open the receipt photo."); }
});
