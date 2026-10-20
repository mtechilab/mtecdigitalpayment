/** Finance cash rules. No database or network imports, so they can be tested directly. */
export const FINANCE_ROLES = ["finance", "administrator"] as const;
export const MAX_CASH_AMOUNT = 100000;

export function canRecordCash(role: unknown): boolean {
  return typeof role === "string" && (FINANCE_ROLES as readonly string[]).includes(role);
}

export function validateCashAmount(amount: unknown): string | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "The amount must be a number.";
  if (amount <= 0 || amount > MAX_CASH_AMOUNT) return `The amount must be more than 0 and at most ${MAX_CASH_AMOUNT}.`;
  return null;
}

export function validateClientReference(ref: unknown): string | null {
  if (typeof ref !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(ref)) return "The payment reference is missing or invalid.";
  return null;
}

/** The SMS and share text, in the format the finance office uses. */
export function receiptText(input: {
  receiptNumber: string; studentName: string; amount: number; paymentType: string; balance: number; date: string;
}): string {
  return [
    "MTeC Payment Receipt",
    input.receiptNumber,
    input.studentName,
    `Paid: NLe ${input.amount.toFixed(2)} (${input.paymentType})`,
    `Balance: NLe ${input.balance.toFixed(2)}`,
    input.date,
    "Thank you - MTeC Finance",
  ].join("\n");
}
