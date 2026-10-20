import { listAllReceipts, receiptOwner } from "../services/financeReceiptsService.js";
import { canRecordCash } from "../services/financeCashPolicy.js";
import { streamReceiptPdf } from "../services/receiptPdfService.js";
import { Router, Request, Response } from "express";
import { requireStaffAuth, StaffRequest } from "../middleware/staffAuth.js";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";
import { lookupStudent, recordCash, cashReceiptLink, listCashRecords } from "../services/financeCashService.js";

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  res.status(/not found/i.test(message) ? 404 : /only finance|only administrators/i.test(message) ? 403 : 400).json({ error: message });
}

/** PDF failures: a 404 only when the receipt is really not found; anything else is a server error. */
function pdfFail(res: Response, err: unknown) {
  const message = (err as Error).message || "Could not create the receipt.";
  res.status(/not found/i.test(message) ? 404 : 500).json({ error: message });
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

/** Every receipt, with a PDF for each, for finance officers (and administrators). */
staffFinanceRouter.get("/receipts", async (req: Request, res: Response) => {
  try {
    const staff = (req as StaffRequest).staff;
    if (!staff || !canRecordCash(staff.role)) return res.status(403).json({ error: "Only finance officers can view receipts here." });
    res.json({ receipts: await listAllReceipts() });
  } catch (err) { fail(res, err, "Could not load the receipts."); }
});
staffFinanceRouter.get("/receipts/:receiptNumber/pdf", async (req: Request, res: Response) => {
  try {
    const staff = (req as StaffRequest).staff;
    if (!staff || !canRecordCash(staff.role)) return res.status(403).json({ error: "Only finance officers can view receipts here." });
    await streamReceiptPdf(await receiptOwner(req.params.receiptNumber), req.params.receiptNumber, res);
  } catch (err) { if (!res.headersSent) pdfFail(res, err); }
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

adminFinanceRouter.get("/receipts", async (_req: AdminRequest, res: Response) => {
  try { res.json({ receipts: await listAllReceipts() }); }
  catch (err) { fail(res, err, "Could not load the receipts."); }
});
adminFinanceRouter.get("/receipts/:receiptNumber/pdf", async (req: AdminRequest, res: Response) => {
  try { await streamReceiptPdf(await receiptOwner(req.params.receiptNumber), req.params.receiptNumber, res); }
  catch (err) { if (!res.headersSent) pdfFail(res, err); }
});

adminFinanceRouter.get("/cash", async (_req: AdminRequest, res: Response) => {
  try { res.json({ records: await listCashRecords() }); }
  catch (err) { fail(res, err, "Could not load the cash records."); }
});
