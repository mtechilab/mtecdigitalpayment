import { streamApplicationForm } from "../services/applicationFormPdfService.js";
import { streamAdminLetter } from "../services/applicantLetterService.js";
import { streamApplicantLetter } from "../services/applicantLetterService.js";
import { Router, Request, Response } from "express";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  getFees, applicantStatus, submitApplicantPayment, setFee, listPendingPayments, receiptLink, reviewPayment, acceptApplication,
} from "../services/applicationPaymentService.js";

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  res.status(/not correct|not found/i.test(message) ? 404 : 400).json({ error: message });
}

export const applicationPaymentRouter = Router();

// Public: the fee for each level, shown on the form before the applicant submits.
applicationPaymentRouter.get("/fees", async (_req: Request, res: Response) => {
  try { res.json({ fees: await getFees() }); }
  catch (err) { fail(res, err, "Could not load the fees."); }
});

// Applicant portal: the application number and PIN are sent in the body, never in the address.
applicationPaymentRouter.post("/portal/status", rateLimit("app-portal-login", 20, 15 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const { applicationNumber, pin } = (req.body || {}) as { applicationNumber?: string; pin?: string };
    if (!applicationNumber || !pin) return res.status(400).json({ error: "Enter your application number and PIN." });
    res.json(await applicantStatus(applicationNumber, pin));
  } catch (err) { fail(res, err, "Could not load your application."); }
});

applicationPaymentRouter.post("/portal/payment", rateLimit("app-portal-payment", 10, 60 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.applicationNumber !== "string" || typeof body.pin !== "string") {
      return res.status(400).json({ error: "Enter your application number and PIN." });
    }
    res.json(await submitApplicantPayment(body.applicationNumber, body.pin, {
      method: body.method, reference: body.reference, receiptBase64: body.receiptBase64, receiptContentType: body.receiptContentType,
    }));
  } catch (err) { fail(res, err, "Could not record your payment."); }
});

// Admin
applicationPaymentRouter.get("/admin/fees", requireAdminAuth, async (_req: AdminRequest, res: Response) => {
  try { res.json({ fees: await getFees() }); }
  catch (err) { fail(res, err, "Could not load the fees."); }
});

applicationPaymentRouter.post("/admin/fees", requireAdminAuth, async (req: AdminRequest, res: Response) => {
  try {
    const { level, amount } = (req.body || {}) as { level?: unknown; amount?: unknown };
    res.json(await setFee(req.adminUsername || "admin", level, amount));
  } catch (err) { fail(res, err, "Could not update the fee."); }
});

applicationPaymentRouter.get("/admin/payments/pending", requireAdminAuth, async (_req: AdminRequest, res: Response) => {
  try { res.json({ payments: await listPendingPayments() }); }
  catch (err) { fail(res, err, "Could not load the payments."); }
});

applicationPaymentRouter.get("/admin/payments/:id/receipt", requireAdminAuth, async (req: AdminRequest, res: Response) => {
  try { res.json(await receiptLink(req.params.id)); }
  catch (err) { fail(res, err, "Could not open the receipt."); }
});

applicationPaymentRouter.post("/admin/payments/:id/review", requireAdminAuth, async (req: AdminRequest, res: Response) => {
  try {
    const { decision, reason } = (req.body || {}) as { decision?: unknown; reason?: unknown };
    res.json(await reviewPayment(req.adminUsername || "admin", req.params.id, decision, reason));
  } catch (err) { fail(res, err, "Could not review the payment."); }
});

// Applicant portal: the acceptance letter, once accepted. Sent as a PDF to download and share.
applicationPaymentRouter.post("/portal/letter", rateLimit("app-portal-letter", 20, 15 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const { applicationNumber, pin } = (req.body || {}) as { applicationNumber?: string; pin?: string };
    if (!applicationNumber || !pin) return res.status(400).json({ error: "Enter your application number and PIN." });
    await streamApplicantLetter(applicationNumber, pin, res);
  } catch (err) {
    if (!res.headersSent) fail(res, err, "Could not create your letter.");
  }
});

// Admin: accept an application once its fee is verified. Rejection uses the existing reject endpoint.
applicationPaymentRouter.post("/admin/applications/:id/accept", requireAdminAuth, async (req: AdminRequest, res: Response) => {
  try { res.json(await acceptApplication(req.adminUsername || "admin", req.params.id)); }
  catch (err) { fail(res, err, "Could not accept the application."); }
});

// Admin: the filled application form as a PDF, for the admission record.
applicationPaymentRouter.get("/admin/applications/:id/form", requireAdminAuth, async (req: AdminRequest, res: Response) => {
  try { await streamApplicationForm(req.params.id, res); }
  catch (err) { if (!res.headersSent) fail(res, err, "Could not create the form."); }
});

// Admin: the acceptance letter for any applicant, as a PDF.
applicationPaymentRouter.get("/admin/applications/:id/letter", requireAdminAuth, async (req: AdminRequest, res: Response) => {
  try { await streamAdminLetter(req.params.id, res); }
  catch (err) { if (!res.headersSent) fail(res, err, "Could not create the letter."); }
});
