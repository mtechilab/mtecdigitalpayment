/** Semester registration rules. No database or network imports, so they can be tested directly. */
export type WindowState = "closed" | "upcoming" | "open" | "late";

export interface Window {
  opensAt: string; closesAt: string; lateClosesAt: string | null; surchargePercent: number; isOpen: boolean;
}

/** Whether registration is open now, on time, late with the surcharge, upcoming, or closed. */
export function windowState(win: Window, now: Date = new Date()): WindowState {
  if (!win.isOpen) return "closed";
  const t = now.getTime();
  if (t < new Date(win.opensAt).getTime()) return "upcoming";
  if (t <= new Date(win.closesAt).getTime()) return "open";
  if (win.lateClosesAt && t <= new Date(win.lateClosesAt).getTime()) return "late";
  return "closed";
}

/** The amount the student pays. A late registration adds the surcharge percentage to the semester fee. */
export function amountDue(tuition: number, state: WindowState, surchargePercent: number): number {
  if (state === "late") return Math.round(tuition * (1 + surchargePercent / 100) * 100) / 100;
  return Math.round(tuition * 100) / 100;
}

export function validateWindowInput(input: { opensAt: string; closesAt: string; lateClosesAt: string | null; surchargePercent: number }): string | null {
  const opens = new Date(input.opensAt).getTime(), closes = new Date(input.closesAt).getTime();
  if (!Number.isFinite(opens) || !Number.isFinite(closes)) return "Enter valid opening and closing dates.";
  if (closes <= opens) return "The closing date must be after the opening date.";
  if (input.lateClosesAt) {
    const late = new Date(input.lateClosesAt).getTime();
    if (!Number.isFinite(late) || late <= closes) return "The late deadline must be after the closing date.";
  }
  if (!Number.isInteger(input.surchargePercent) || input.surchargePercent < 0 || input.surchargePercent > 100) return "The surcharge must be a whole number from 0 to 100.";
  return null;
}

export function validateCourses(list: unknown): string | null {
  if (!Array.isArray(list)) return "Courses must be a list.";
  if (list.length > 20) return "A student can have at most 20 courses in one semester.";
  const seen = new Set<string>();
  for (const item of list) {
    const c = (item || {}) as { code?: unknown; name?: unknown };
    if (typeof c.code !== "string" || c.code.trim().length < 2 || c.code.trim().length > 20) return "Each course needs a code of 2 to 20 characters.";
    if (typeof c.name !== "string" || c.name.trim().length < 3 || c.name.trim().length > 120) return "Each course needs a name of 3 to 120 characters.";
    const key = c.code.trim().toUpperCase();
    if (seen.has(key)) return "The same course is listed twice.";
    seen.add(key);
  }
  return null;
}
