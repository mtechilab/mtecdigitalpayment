/** Rules for admin changes to students, programmes, and fees. No database or network imports. */
export const STUDENT_STATUSES = ["active", "inactive"] as const;

export function validateStudentUpdate(f: { fullName?: unknown; phone?: unknown; email?: unknown; level?: unknown; status?: unknown }): string | null {
  if (f.fullName !== undefined && (typeof f.fullName !== "string" || f.fullName.trim().length < 3 || f.fullName.trim().length > 120)) return "The name must be 3 to 120 characters.";
  if (f.phone !== undefined && (typeof f.phone !== "string" || f.phone.trim().length < 6 || f.phone.trim().length > 30)) return "Enter a valid phone number.";
  if (f.email !== undefined && f.email !== "" && (typeof f.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))) return "Enter a valid email address.";
  if (f.level !== undefined && (typeof f.level !== "string" || f.level.trim().length < 1 || f.level.trim().length > 20)) return "The level must be 1 to 20 characters.";
  if (f.status !== undefined && !(STUDENT_STATUSES as readonly string[]).includes(f.status as string)) return "The status must be active or inactive.";
  return null;
}

export function validateProgramme(p: { name?: unknown; durationYears?: unknown; category?: unknown; mode?: unknown }): string | null {
  if (typeof p.name !== "string" || p.name.trim().length < 3 || p.name.trim().length > 120) return "The programme name must be 3 to 120 characters.";
  if (p.durationYears !== undefined && (typeof p.durationYears !== "number" || !(p.durationYears > 0 && p.durationYears <= 10))) return "The duration must be more than 0 and at most 10 years.";
  if (p.category !== undefined && (typeof p.category !== "string" || p.category.length > 60)) return "The category is too long.";
  if (p.mode !== undefined && (typeof p.mode !== "string" || p.mode.length > 60)) return "The mode is too long.";
  return null;
}

export function validateFees(registration: unknown, tuition: unknown): string | null {
  const max = 100000;
  if (typeof registration !== "number" || !Number.isFinite(registration) || registration < 0 || registration > max) return "The registration fee must be 0 or more, and at most 100000.";
  if (typeof tuition !== "number" || !Number.isFinite(tuition) || tuition <= 0 || tuition > max) return "The tuition per semester must be more than 0, and at most 100000.";
  return null;
}

/** A student can be deleted only when every related record count is exactly zero. Any doubt refuses. */
export function canDeleteStudent(counts: (number | null)[]): boolean {
  return counts.length > 0 && counts.every((c) => c === 0);
}

export const COURSE_TYPES = ["short_course", "certificate", "diploma"] as const;
export const DURATION_UNITS = ["months", "years"] as const;

/** The course type and duration. Both can be edited by the admin, so any unit is allowed for any type. */
export function validateDuration(courseType: unknown, value: unknown, unit: unknown): string | null {
  if (!(COURSE_TYPES as readonly string[]).includes(courseType as string)) return "Choose Short course, Certificate or Diploma.";
  if (!(DURATION_UNITS as readonly string[]).includes(unit as string)) return "The duration unit must be months or years.";
  const max = unit === "months" ? 60 : 10;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    return `The duration must be a whole number from 1 to ${max} ${unit}.`;
  }
  return null;
}

/** The yearly equivalent, kept for older screens that still read duration_years. */
export function yearsEquivalent(value: number, unit: string): number {
  return unit === "years" ? value : Math.max(1, Math.round(value / 12));
}
