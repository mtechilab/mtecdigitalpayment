import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { finalizeVerifiedPayment } from "./paymentPlanService.js";
import { canRecordCash, validateCashAmount, validateClientReference, receiptText } from "./financeCashPolicy.js";
import { validateReceipt } from "./applicationPaymentPolicy.js";

const RECEIPT_BUCKET = "finance-receipts";
const LINK_SECONDS = 300;

/** A student's name, programme, and outstanding balance, for the finance officer to confirm before taking cash. */
export async function lookupStudent(studentId: string) {
  const supabase = getSupabase();
  const { data: student } = await supabase.from("students").select("id, student_id, full_name, programme, status")
    .eq("student_id", studentId.trim()).maybeSingle();
  const row = student as unknown as { id: string; student_id: string; full_name: string; programme: string; status: string } | null;
  if (!row) throw new Error("No student has that student ID.");
  const { data: plan } = await supabase.from("payment_plans").select("id").eq("student_row_id", row.id).limit(1).maybeSingle();
  const planId = (plan as unknown as { id: string } | null)?.id || null;
  let balance: number | null = null;
  if (planId) {
    const { data: periods } = await supabase.from("payment_periods").select("amount_due, amount_paid").eq("payment_plan_id", planId);
    balance = ((periods || []) as unknown as { amount_due: number; amount_paid: number }[])
      .reduce((sum, p) => sum + (Number(p.amount_due) - Number(p.amount_paid)), 0);
  }
  return { studentRowId: row.id, studentId: row.student_id, fullName: row.full_name, programme: row.programme, status: row.status, hasPaymentPlan: !!planId, balance };
}

/** Records cash taken at the office. Uses the same confirmation as an approved payment, so the balance and the
 *  student's panel update together. A repeated reference returns the receipt already made, and records nothing new. */
export async function recordCash(actorName: string, actorUsername: string, role: unknown, input: {
  studentId: string; amount: unknown; paymentType: string; clientReference: unknown;
  receiptBase64?: unknown; receiptContentType?: unknown; reference?: unknown;
}) {
  if (!canRecordCash(role)) throw new Error("Only finance officers and administrators can record cash.");
  const amountProblem = validateCashAmount(input.amount);
  if (amountProblem) throw new Error(amountProblem);
  const refProblem = validateClientReference(input.clientReference);
  if (refProblem) throw new Error(refProblem);
  const supabase = getSupabase();
  const ref = input.clientReference as string;

  const { data: existing } = await supabase.from("payment_submissions").select("id, status").eq("client_reference", ref).maybeSingle();
  if (existing) {
    return { success: true, duplicate: true, receiptNumber: await receiptForReference(ref) };
  }

  // An optional reference code, such as an Orange Money reference or a cash slip number.
  const referenceText = typeof input.reference === "string" ? input.reference.trim() : "";
  if (referenceText && !/^[A-Za-z0-9 \/-]{3,40}$/.test(referenceText)) {
    throw new Error("The reference code must be 3 to 40 letters, numbers, spaces, dashes or slashes.");
  }
  // A photo of the receipt must be attached before the payment is recorded.
  const photoProblem = validateReceipt(input.receiptContentType, input.receiptBase64);
  if (photoProblem) throw new Error(`Attach a photo of the cash receipt. ${photoProblem}`);
  const contentType = input.receiptContentType as string;
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";

  const student = await lookupStudent(input.studentId);
  if (!student.hasPaymentPlan) throw new Error("This student has no payment plan yet. Set up the payment plan first.");
  const { data: plan } = await supabase.from("payment_plans").select("id").eq("student_row_id", student.studentRowId).limit(1).maybeSingle();
  const planId = (plan as unknown as { id: string }).id;

  const receiptPath = `${student.studentRowId}/${ref}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(RECEIPT_BUCKET)
    .upload(receiptPath, Buffer.from(input.receiptBase64 as string, "base64"), { contentType, upsert: false });
  if (uploadError) throw new Error(`Could not store the receipt photo: ${uploadError.message}`);

  const { data: sub, error } = await supabase.from("payment_submissions").insert({
    student_row_id: student.studentRowId, payment_plan_id: planId, amount: input.amount as number,
    method: "cash", status: "pending", client_reference: ref, mtec_reference: ref,
    finance_receipt_path: receiptPath, finance_receipt_type: contentType, finance_recorded_by: actorName,
    finance_reference: referenceText || null,
  }).select("id").single();
  if (error) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([receiptPath]);
    throw new Error(`recordCash failed: ${error.message}`);
  }
  const submissionId = (sub as unknown as { id: string }).id;

  await finalizeVerifiedPayment(submissionId, `Cash (recorded by ${actorName})`);
  await recordAudit({ actor: actorUsername, action: "payment.cash_recorded", entityType: "payment_submission", entityId: submissionId, detail: { amount: input.amount, paymentType: input.paymentType } });

  const receiptNumber = await receiptForReference(ref);
  const balanceAfter = (await lookupStudent(input.studentId)).balance ?? 0;
  const receipt = receiptNumber ? receiptText({
    receiptNumber, studentName: student.fullName, amount: input.amount as number,
    paymentType: input.paymentType, balance: balanceAfter, date: new Date().toISOString().slice(0, 19),
  }) : null;
  return { success: true, duplicate: false, receiptNumber, balance: balanceAfter, receiptText: receipt };
}

/** The receipt for a payment, found through its submission. */
async function receiptForReference(ref: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data: sub } = await supabase.from("payment_submissions").select("student_row_id, amount").eq("client_reference", ref).maybeSingle();
  const s = sub as unknown as { student_row_id: string; amount: number } | null;
  if (!s) return null;
  const { data: receipt } = await supabase.from("receipts").select("receipt_number, date")
    .eq("student_row_id", s.student_row_id).order("date", { ascending: false }).limit(1).maybeSingle();
  return (receipt as unknown as { receipt_number: string } | null)?.receipt_number || null;
}

/** The receipt photo for a cash payment, as a short-lived link, so the admin can verify it. */
export async function cashReceiptLink(clientReference: string) {
  const { data } = await getSupabase().from("payment_submissions").select("finance_receipt_path")
    .eq("client_reference", clientReference).maybeSingle();
  const path = (data as unknown as { finance_receipt_path: string | null } | null)?.finance_receipt_path;
  if (!path) throw new Error("That payment has no receipt photo.");
  const { data: signed, error } = await getSupabase().storage.from(RECEIPT_BUCKET).createSignedUrl(path, LINK_SECONDS);
  if (error || !signed) throw new Error(`Could not create the link: ${error?.message || "unknown"}`);
  return { url: signed.signedUrl, expiresInSeconds: LINK_SECONDS };
}

/** The cash recorded by finance officers, newest first, for administrators to review. */
export async function listCashRecords(limit: number = 100) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("payment_submissions")
    .select("id, client_reference, amount, student_row_id, finance_receipt_path, finance_recorded_by, finance_reference, created_at")
    .eq("method", "cash").not("client_reference", "is", null)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`listCashRecords failed: ${error.message}`);
  const rows = (data || []) as unknown as {
    client_reference: string; amount: number; student_row_id: string; finance_receipt_path: string | null; finance_recorded_by: string | null; created_at: string;
  }[];
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.student_row_id))];
  const { data: students } = await supabase.from("students").select("id, student_id, full_name, programme").in("id", ids);
  const byId = new Map(((students || []) as unknown as { id: string; student_id: string; full_name: string; programme: string }[])
    .map((s) => [s.id, s]));
  return rows.map((r) => {
    const st = byId.get(r.student_row_id);
    return {
      reference: r.client_reference, amount: r.amount, studentId: st?.student_id || "", fullName: st?.full_name || "",
      programme: st?.programme || "", recordedBy: r.finance_recorded_by || "", recordedAt: r.created_at,
      hasReceipt: !!r.finance_receipt_path,
      referenceCode: (r as unknown as { finance_reference: string | null }).finance_reference || "",
    };
  });
}
