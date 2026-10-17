import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import {
  Level, validateLevel, validateReference, validateReceipt, validateFeeAmount, paymentPrecheck, ORANGE_MONEY_NUMBER,
} from "./applicationPaymentPolicy.js";

const BUCKET = "application-receipts";
const LINK_SECONDS = 300;
const WRONG_LOGIN = "The application number or PIN is not correct.";

interface ApplicationRow {
  id: string; application_number: string; status: string; full_name: string; programme: string;
  programme_level: string | null; pin_id: string;
}

/** Checks the application number and PIN together. The same wrong-login message is used either way,
 *  so the portal does not reveal which of the two was wrong. */
async function authenticate(applicationNumber: string, pin: string): Promise<ApplicationRow> {
  const supabase = getSupabase();
  const { data: app, error } = await supabase.from("applications")
    .select("id, application_number, status, full_name, programme, programme_level, pin_id")
    .eq("application_number", applicationNumber.trim()).maybeSingle();
  if (error) throw new Error(`authenticate failed: ${error.message}`);
  const row = app as unknown as ApplicationRow | null;
  if (!row) throw new Error(WRONG_LOGIN);
  const { data: pinRow } = await supabase.from("application_pins").select("pin").eq("id", row.pin_id).maybeSingle();
  const stored = (pinRow as unknown as { pin: string } | null)?.pin;
  if (!stored || stored !== pin.trim()) throw new Error(WRONG_LOGIN);
  return row;
}

async function feeFor(level: Level): Promise<number> {
  const { data, error } = await getSupabase().from("application_fees").select("amount").eq("level", level).maybeSingle();
  if (error) throw new Error(`feeFor failed: ${error.message}`);
  const amount = (data as unknown as { amount: number } | null)?.amount;
  if (typeof amount !== "number") throw new Error("The fee for this level is not set. Contact admissions.");
  return amount;
}

async function paymentsFor(applicationId: string) {
  const { data, error } = await getSupabase().from("application_payments")
    .select("id, method, amount, status, review_reason, submitted_at")
    .eq("application_id", applicationId).order("submitted_at", { ascending: false });
  if (error) throw new Error(`paymentsFor failed: ${error.message}`);
  return (data || []) as unknown as { id: string; method: string; amount: number; status: string; review_reason: string | null; submitted_at: string }[];
}

/** The fee list shown on the form, so the applicant sees the amount for each level. */
export async function getFees() {
  const { data, error } = await getSupabase().from("application_fees").select("level, amount").order("level", { ascending: true });
  if (error) throw new Error(`getFees failed: ${error.message}`);
  return ((data || []) as unknown as { level: string; amount: number }[]).map((f) => ({ level: f.level, amount: f.amount }));
}

/** The applicant's status, fee, and payments. Used by the app and the web portal alike. */
export async function applicantStatus(applicationNumber: string, pin: string) {
  const app = await authenticate(applicationNumber, pin);
  const payments = await paymentsFor(app.id);
  const paid = payments.some((p) => p.status === "verified");
  const pending = payments.some((p) => p.status === "pending");
  const level = validateLevel(app.programme_level) ? app.programme_level : null;
  const feeDue = level ? await feeFor(level) : null;
  return {
    applicationNumber: app.application_number,
    fullName: app.full_name,
    programme: app.programme,
    programmeLevel: level,
    status: app.status,
    feeDue,
    paid,
    payments: payments.map((p) => ({ id: p.id, method: p.method, amount: p.amount, status: p.status, reviewReason: p.review_reason, submittedAt: p.submitted_at })),
    canPay: paymentPrecheck(app.status, paid, pending),
    payNumber: ORANGE_MONEY_NUMBER,
  };
}

/** The applicant pays by Orange Money (with the transaction reference) or by cash (with a receipt photo). */
export async function submitApplicantPayment(applicationNumber: string, pin: string, input: {
  method: unknown; reference?: unknown; receiptBase64?: unknown; receiptContentType?: unknown;
}) {
  const app = await authenticate(applicationNumber, pin);
  if (!validateLevel(app.programme_level)) throw new Error("Your application has no programme level. Contact admissions.");
  const payments = await paymentsFor(app.id);
  const blocked = paymentPrecheck(app.status, payments.some((p) => p.status === "verified"), payments.some((p) => p.status === "pending"));
  if (blocked) throw new Error(blocked);
  const amount = await feeFor(app.programme_level);
  const supabase = getSupabase();

  if (input.method === "orange_money") {
    const problem = validateReference(input.reference);
    if (problem) throw new Error(problem);
    const { error } = await supabase.from("application_payments").insert({
      application_id: app.id, method: "orange_money", amount, reference: (input.reference as string).trim(),
    });
    if (error) throw new Error(`submitApplicantPayment failed: ${error.message}`);
    return { success: true, status: "pending" };
  }

  if (input.method === "cash") {
    const problem = validateReceipt(input.receiptContentType, input.receiptBase64);
    if (problem) throw new Error(problem);
    const contentType = input.receiptContentType as string;
    const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const path = `${app.id}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET)
      .upload(path, Buffer.from(input.receiptBase64 as string, "base64"), { contentType, upsert: false });
    if (uploadError) throw new Error(`Could not store the receipt: ${uploadError.message}`);
    const { error } = await supabase.from("application_payments").insert({
      application_id: app.id, method: "cash", amount, receipt_path: path, receipt_type: contentType,
    });
    if (error) {
      await supabase.storage.from(BUCKET).remove([path]);
      throw new Error(`submitApplicantPayment failed: ${error.message}`);
    }
    return { success: true, status: "pending" };
  }

  throw new Error("Choose Orange Money or cash.");
}

/** Admin: the fee for a level. Changing it affects applications submitted from then on. */
export async function setFee(adminName: string, level: unknown, amount: unknown) {
  if (!validateLevel(level)) throw new Error("Choose Certificate or Diploma.");
  const problem = validateFeeAmount(amount);
  if (problem) throw new Error(problem);
  const { error } = await getSupabase().from("application_fees").upsert(
    { level, amount: amount as number, updated_at: new Date().toISOString(), updated_by: adminName },
    { onConflict: "level" });
  if (error) throw new Error(`setFee failed: ${error.message}`);
  await recordAudit({ actor: adminName, action: "application_fee.set", entityType: "application_fee", entityId: level, detail: { amount } });
  return { success: true };
}

/** Admin: cash and Orange Money payments waiting to be checked, with the applicant they belong to. */
export async function listPendingPayments() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("application_payments")
    .select("id, application_id, method, amount, reference, receipt_path, submitted_at")
    .eq("status", "pending").order("submitted_at", { ascending: true }).limit(200);
  if (error) throw new Error(`listPendingPayments failed: ${error.message}`);
  const rows = (data || []) as unknown as { id: string; application_id: string; method: string; amount: number; reference: string | null; receipt_path: string | null; submitted_at: string }[];
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.application_id))];
  const { data: apps } = await supabase.from("applications")
    .select("id, application_number, full_name, programme, programme_level").in("id", ids);
  const byId = new Map(((apps || []) as unknown as { id: string; application_number: string; full_name: string; programme: string; programme_level: string | null }[])
    .map((a) => [a.id, a]));
  return rows.map((r) => {
    const a = byId.get(r.application_id);
    return {
      id: r.id, method: r.method, amount: r.amount, reference: r.reference, hasReceipt: !!r.receipt_path, submittedAt: r.submitted_at,
      applicationNumber: a?.application_number || "", fullName: a?.full_name || "", programme: a?.programme || "", programmeLevel: a?.programme_level || null,
    };
  });
}

/** Admin: a short-lived link to the receipt photo, for checking. */
export async function receiptLink(paymentId: string) {
  const { data, error } = await getSupabase().from("application_payments").select("receipt_path").eq("id", paymentId).maybeSingle();
  if (error) throw new Error(`receiptLink failed: ${error.message}`);
  const path = (data as unknown as { receipt_path: string | null } | null)?.receipt_path;
  if (!path) throw new Error("That payment has no receipt photo.");
  const { data: signed, error: signError } = await getSupabase().storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS);
  if (signError || !signed) throw new Error(`Could not create the receipt link: ${signError?.message || "unknown"}`);
  return { url: signed.signedUrl, expiresInSeconds: LINK_SECONDS };
}

/** Admin: verify a payment, or reject it with a reason the applicant will see. */
export async function reviewPayment(adminName: string, paymentId: string, decision: unknown, reason: unknown) {
  if (decision !== "verify" && decision !== "reject") throw new Error("The decision must be verify or reject.");
  const supabase = getSupabase();
  const { data, error } = await supabase.from("application_payments").select("id, status").eq("id", paymentId).maybeSingle();
  if (error) throw new Error(`reviewPayment failed: ${error.message}`);
  const row = data as unknown as { id: string; status: string } | null;
  if (!row) throw new Error("That payment was not found.");
  if (row.status !== "pending") throw new Error("This payment has already been reviewed.");
  let reviewReason: string | null = null;
  if (decision === "reject") {
    const text = typeof reason === "string" ? reason.trim() : "";
    if (text.length < 3 || text.length > 300) throw new Error("Give a reason of 3 to 300 characters.");
    reviewReason = text;
  }
  const { error: updateError } = await supabase.from("application_payments").update({
    status: decision === "verify" ? "verified" : "rejected",
    review_reason: reviewReason,
    reviewed_at: new Date().toISOString(),
    reviewed_by: adminName,
  }).eq("id", paymentId);
  if (updateError) throw new Error(`reviewPayment (update) failed: ${updateError.message}`);
  await recordAudit({ actor: adminName, action: decision === "verify" ? "application_payment.verify" : "application_payment.reject", entityType: "application_payment", entityId: paymentId, detail: {} });
  return { success: true, status: decision === "verify" ? "verified" : "rejected" };
}
