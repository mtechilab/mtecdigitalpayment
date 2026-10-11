import { getSupabase } from "../db/supabaseClient.js";

const BUCKET = "payment-proofs";
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** The student says they've paid. They must give the Monime order number, a
 *  screenshot, or both, so an admin has something to check. The payment moves to
 *  'under_review' and the admin queue shows it. Only the student who owns the
 *  payment (matched by their row id) can claim it. */
export async function claimPaid(
  studentRowId: string,
  input: { mtecReference: string; providerReference?: string; proofBase64?: string; proofContentType?: string },
) {
  const supabase = getSupabase();
  const reference = input.mtecReference.trim();
  const providerRef = (input.providerReference || "").trim();
  if (!providerRef && !input.proofBase64) {
    throw new Error("Enter the Monime order number, or upload a screenshot of the payment.");
  }

  const { data: submission, error } = await supabase
    .from("payment_submissions")
    .select("id, status")
    .eq("mtec_reference", reference)
    .eq("student_row_id", studentRowId)
    .maybeSingle();
  if (error) throw new Error(`claimPaid failed: ${error.message}`);
  if (!submission) throw new Error("No payment found for that reference.");
  if (submission.status === "verified") throw new Error("This payment has already been confirmed.");

  let proofPath: string | null = null;
  if (input.proofBase64) {
    const ext = EXTENSIONS[input.proofContentType || ""];
    if (!ext) throw new Error("The screenshot must be a JPG, PNG or WEBP image.");
    const bytes = Buffer.from(input.proofBase64, "base64");
    if (bytes.length === 0) throw new Error("The screenshot could not be read. Try a different photo.");
    if (bytes.length > MAX_PROOF_BYTES) throw new Error("The screenshot is larger than 5 MB. Try a smaller photo.");
    proofPath = `${studentRowId}/${submission.id}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(proofPath, bytes, {
      contentType: input.proofContentType,
      upsert: false,
    });
    if (uploadError) throw new Error(`Could not store the screenshot: ${uploadError.message}`);
  }

  const update: { status: string; rejection_reason: null; provider_reference?: string; proof_path?: string; proof_uploaded_at?: string } = {
    status: "under_review",
    rejection_reason: null,
  };
  if (providerRef) update.provider_reference = providerRef;
  if (proofPath) {
    update.proof_path = proofPath;
    update.proof_uploaded_at = new Date().toISOString();
  }
  const { error: updateError } = await supabase.from("payment_submissions").update(update).eq("id", submission.id);
  if (updateError) throw new Error(`claimPaid update failed: ${updateError.message}`);
  return { success: true, status: "under_review" };
}

/** The screenshot for one payment, for an admin to look at. */
export async function getProofForAdmin(submissionId: string) {
  const supabase = getSupabase();
  const { data: submission, error } = await supabase
    .from("payment_submissions").select("proof_path").eq("id", submissionId).maybeSingle();
  if (error) throw new Error(`getProofForAdmin failed: ${error.message}`);
  if (!submission?.proof_path) throw new Error("No screenshot was uploaded for this payment.");

  const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(submission.proof_path);
  if (downloadError || !file) throw new Error(`Could not load the screenshot: ${downloadError?.message || "missing file"}`);

  const ext = submission.proof_path.split(".").pop();
  const contentType = Object.keys(EXTENSIONS).find((type) => EXTENSIONS[type] === ext) || "application/octet-stream";
  return { bytes: Buffer.from(await file.arrayBuffer()), contentType };
}
