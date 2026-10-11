/** How often a student can pay, and the amount each payment should be.
 *  Pure arithmetic with no database access, so it can be tested directly.
 *  Step sizes are the same ones the schedule is built from. */

export type PayFrequency = "daily" | "weekly" | "monthly" | "semester" | "yearly";

export const FREQUENCY_STEP_DAYS: Record<PayFrequency, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  semester: 182,
  yearly: 365,
};

export const PAY_FREQUENCIES: PayFrequency[] = ["daily", "weekly", "monthly", "semester", "yearly"];

const cents = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;

export interface FrequencyQuote {
  frequency: PayFrequency;
  /** How many payments of this frequency are left before the plan ends. */
  paymentsLeft: number;
  /** What one payment at this frequency should be to clear the balance by the plan end. */
  suggestedAmount: number;
  /** The most a student can pay in one go: everything still owed. */
  maxAmount: number;
}

/** @param remainingBalance  total still owed on the plan
 *  @param daysRemaining     whole days from today until the plan ends (0 once it has ended) */
export function quoteFrequency(remainingBalance: number, daysRemaining: number, frequency: PayFrequency): FrequencyQuote {
  const remaining = cents(Math.max(0, remainingBalance));
  const days = Math.max(0, Math.floor(daysRemaining));
  const paymentsLeft = Math.max(1, Math.ceil(days / FREQUENCY_STEP_DAYS[frequency]));
  return {
    frequency,
    paymentsLeft,
    suggestedAmount: Math.min(remaining, cents(remaining / paymentsLeft)),
    maxAmount: remaining,
  };
}

export function quoteAllFrequencies(remainingBalance: number, daysRemaining: number): FrequencyQuote[] {
  return PAY_FREQUENCIES.map((f) => quoteFrequency(remainingBalance, daysRemaining, f));
}
