/** Admin data editor rules. No database or network imports, so they can be tested directly. */
export interface TableRule {
  key: string;              // the column that identifies a row
  editable: string[];       // the only columns an admin may change
  search: string[];         // columns the search box looks in
  active?: { column: string; off: unknown; on: unknown }; // how a row is deactivated
  match: string;            // the column that identifies a row when importing a spreadsheet
  importCreate: boolean;    // whether a spreadsheet may add new rows to this table
}

/** The tables the editor can reach. Anything not listed here cannot be changed from the screen. */
export const TABLE_RULES: Record<string, TableRule> = {
  students: {
    key: "id", editable: ["full_name", "phone", "email", "programme", "level", "academic_year", "status"],
    search: ["full_name", "student_id", "phone"], active: { column: "status", off: "inactive", on: "active" }, match: "student_id", importCreate: false,
  },
  programmes: {
    key: "id", editable: ["department", "category", "mode", "description", "duration_value", "duration_unit", "course_type", "duration_years", "intake_label", "active"],
    search: ["name"], active: { column: "active", off: false, on: true }, match: "name", importCreate: true,
  },
  fee_structures: { key: "programme", editable: ["registration_fee", "tuition_per_semester"], search: ["programme"], match: "programme", importCreate: true },
  semesters: { key: "name", editable: ["sort_order"], search: ["name"], match: "name", importCreate: true },
  courses: { key: "id", editable: ["code", "name", "programme", "level", "semester", "credit_units"], search: ["code", "name"], match: "code", importCreate: true },
  staff_accounts: { key: "id", editable: ["full_name", "role", "active"], search: ["full_name", "username"], active: { column: "active", off: false, on: true }, match: "username", importCreate: false },
  marks: { key: "id", editable: ["score"], search: [], match: "id", importCreate: false },
  news_posts: { key: "id", editable: ["title", "body", "audience", "expires_at"], search: ["title"], match: "id", importCreate: false },
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

/** Parses CSV text (commas, quoted fields, line breaks inside quotes). The first row is the header. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

/** Writes rows as CSV, quoting any value that contains a comma, quote, or line break. */
export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}
