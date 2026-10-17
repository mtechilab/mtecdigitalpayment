/** Application fee and payment rules. No database or network imports, so they can be tested directly. */
export const LEVELS = ["certificate", "diploma"] as const;
export type Level = typeof LEVELS[number];
export const PAYMENT_METHODS = ["orange_money", "cash"] as const;
export type PaymentMethodName = typeof PAYMENT_METHODS[number];

/** The Orange Money number applicants pay to. Shown on the form and in the applicant portal. */
export const ORANGE_MONEY_NUMBER = "+232 76 866 665";
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const MAX_FEE = 100000;

export function validateLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** An Orange Money transaction reference: letters, digits and dashes, 6 to 40 characters. */
export function validateReference(value: unknown): string | null {
  if (typeof value !== "string") return "Enter the Orange Money transaction reference.";
  const t = value.trim();
  if (!/^[A-Za-z0-9-]{6,40}$/.test(t)) return "The transaction reference must be 6 to 40 letters, numbers or dashes.";
  return null;
}

export function validateFeeAmount(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return "The fee must be a number.";
  if (value <= 0 || value > MAX_FEE) return `The fee must be more than 0 and at most ${MAX_FEE}.`;
  return null;
}

export function validateReceipt(contentType: unknown, base64: unknown): string | null {
  if (contentType !== "image/jpeg" && contentType !== "image/png" && contentType !== "image/webp") {
    return "The receipt must be a JPG, PNG or WEBP photo.";
  }
  if (typeof base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return "The receipt could not be read.";
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes <= 0) return "The receipt is empty.";
  if (bytes > MAX_RECEIPT_BYTES) return "The receipt is larger than 5 MB. Choose a smaller photo.";
  return null;
}

/** Whether the applicant may pay now. Returns the reason if not, or null when payment is open. */
export function paymentPrecheck(status: string, alreadyVerified: boolean, pendingExists: boolean): string | null {
  if (alreadyVerified) return "The application fee is already paid.";
  if (pendingExists) return "A payment is already waiting for review.";
  if (["rejected", "accepted", "offer_issued"].includes(status)) return "This application is no longer open for payment.";
  return null;
}
