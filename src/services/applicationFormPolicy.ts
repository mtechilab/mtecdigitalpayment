/** Rules for the paper form's fields. No database or network imports, so they can be tested directly. */
export const MAX_EDUCATION_ROWS = 5;

export interface EducationRow {
  school: string; yearGraduated: string; highestGrade: string; qualification: string; graduated: boolean;
}

export function validateEnrollmentCategory(value: unknown): string | null {
  if (value !== "self_funded" && value !== "sponsored") return "Choose Self-Funded or Scholarship/Sponsored.";
  return null;
}

/** DD/MM/YYYY, as on the paper form, or YYYY-MM-DD. */
export function validateDateOfBirth(value: unknown): string | null {
  if (typeof value !== "string" || !(/^\d{2}\/\d{2}\/\d{4}$/.test(value.trim()) || /^\d{4}-\d{2}-\d{2}$/.test(value.trim()))) {
    return "Date of birth must be DD/MM/YYYY.";
  }
  return null;
}

export function validateGuardian(value: unknown): string | null {
  const g = (value || {}) as Record<string, unknown>;
  const name = typeof g.name === "string" ? g.name.trim() : "";
  const contact = typeof g.contact === "string" ? g.contact.trim() : "";
  const address = typeof g.address === "string" ? g.address.trim() : "";
  const relationship = typeof g.relationship === "string" ? g.relationship.trim() : "";
  if (name.length < 3 || name.length > 120) return "Enter the parent or guardian's full name.";
  if (contact.length < 6 || contact.length > 30) return "Enter the parent or guardian's contact number.";
  if (address.length < 3 || address.length > 200) return "Enter the parent or guardian's address.";
  if (relationship.length < 2 || relationship.length > 60) return "Enter the relationship to the applicant.";
  return null;
}

/** Rows with a school name must also have a year, grade, and qualification. Empty rows are skipped. */
export function validateEducation(value: unknown): string | null {
  if (!Array.isArray(value)) return "Education history must be a list.";
  if (value.length > MAX_EDUCATION_ROWS) return `Education history allows at most ${MAX_EDUCATION_ROWS} schools.`;
  for (const item of value) {
    const row = (item || {}) as Record<string, unknown>;
    const school = typeof row.school === "string" ? row.school.trim() : "";
    if (!school) continue;
    if (school.length > 120) return "A school name is too long.";
    const year = typeof row.yearGraduated === "string" ? row.yearGraduated.trim() : "";
    const grade = typeof row.highestGrade === "string" ? row.highestGrade.trim() : "";
    const qualification = typeof row.qualification === "string" ? row.qualification.trim() : "";
    if (!year || !grade || !qualification) return `Complete the year, highest grade, and qualification for ${school}.`;
  }
  return null;
}

export function cleanEducation(value: unknown): EducationRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item || {}) as Record<string, unknown>)
    .filter((row) => typeof row.school === "string" && row.school.trim().length > 0)
    .map((row) => ({
      school: String(row.school).trim(),
      yearGraduated: String(row.yearGraduated || "").trim(),
      highestGrade: String(row.highestGrade || "").trim(),
      qualification: String(row.qualification || "").trim(),
      graduated: row.graduated === true,
    }));
}

/** The applicant ticks the declaration and types their name, which is recorded with the date. */
export function validateDeclaration(confirmed: unknown, name: unknown, date: unknown): string | null {
  if (confirmed !== true) return "Confirm the declaration to submit your application.";
  if (typeof name !== "string" || name.trim().length < 3 || name.trim().length > 120) return "Type your full name as your signature.";
  if (typeof date !== "string" || date.trim().length < 6 || date.trim().length > 20) return "Enter the date of the declaration.";
  return null;
}
