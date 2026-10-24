/** Admin data editor rules. No database or network imports, so they can be tested directly. */
export interface TableRule {
  key: string;              // the column that identifies a row
  editable: string[];       // the only columns an admin may change
  search: string[];         // columns the search box looks in
  active?: { column: string; off: unknown; on: unknown }; // how a row is deactivated
}

/** The tables the editor can reach. Anything not listed here cannot be changed from the screen. */
export const TABLE_RULES: Record<string, TableRule> = {
  students: {
    key: "id", editable: ["full_name", "phone", "email", "programme", "level", "academic_year", "status"],
    search: ["full_name", "student_id", "phone"], active: { column: "status", off: "inactive", on: "active" },
  },
  programmes: {
    key: "id", editable: ["department", "category", "mode", "description", "duration_value", "duration_unit", "course_type", "duration_years", "intake_label", "active"],
    search: ["name"], active: { column: "active", off: false, on: true },
  },
  fee_structures: { key: "programme", editable: ["registration_fee", "tuition_per_semester"], search: ["programme"] },
  semesters: { key: "name", editable: ["sort_order"], search: ["name"] },
  courses: { key: "id", editable: ["code", "name", "programme", "level", "semester", "credit_units"], search: ["code", "name"] },
  staff_accounts: { key: "id", editable: ["full_name", "role", "active"], search: ["full_name", "username"], active: { column: "active", off: false, on: true } },
  news_posts: { key: "id", editable: ["title", "body", "audience", "expires_at"], search: ["title"] },
};

/** Keeps only the fields the table allows. Anything else is refused, not silently ignored. */
export function allowedFields(table: string, fields: Record<string, unknown>): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const rule = TABLE_RULES[table];
  if (!rule) return { ok: false, error: "That table cannot be edited from the admin screen." };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (!rule.editable.includes(k)) return { ok: false, error: `The field "${k}" cannot be changed here.` };
    out[k] = v;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "Nothing to change." };
  return { ok: true, fields: out };
}

/** Every change needs a reason, so the log explains it later. */
export function validateReason(reason: unknown): string | null {
  if (typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 300) {
    return "Give a reason of 5 to 300 characters. It is written to the change log.";
  }
  return null;
}
