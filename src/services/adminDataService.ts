import { getSupabase } from "../db/supabaseClient.js";
import { TABLE_RULES, allowedFields, validateReason, TableRule, parseCsv, toCsv } from "./adminDataPolicy.js";

// The editor reaches tables by name chosen from TABLE_RULES, so the calls are loosely typed on purpose.
// Every name is checked against TABLE_RULES before it is used.
type Loose = { from(table: string): any; rpc(fn: string, args: Record<string, unknown>): any };
const db = (): Loose => getSupabase() as unknown as Loose;

function ruleFor(table: string): TableRule {
  const rule = TABLE_RULES[table];
  if (!rule) throw new Error("That table cannot be edited from the admin screen.");
  return rule;
}

async function writeLog(actor: string, action: string, table: string, key: string, oldValues: unknown, newValues: unknown, reason: string | null) {
  const { error } = await db().from("admin_change_log").insert({
    actor, action, table_name: table, record_key: key, old_values: oldValues, new_values: newValues, reason,
  });
  if (error) throw new Error(`The change could not be logged, so it was not saved: ${error.message}`);
}

export function listTables() {
  return Object.entries(TABLE_RULES).map(([name, rule]) => ({ name, key: rule.key, editable: rule.editable, searchable: rule.search, canDeactivate: !!rule.active }));
}

export async function listRows(table: string, q: string, limit: number) {
  const rule = ruleFor(table);
  let query = db().from(table).select("*").limit(Math.min(Math.max(limit, 1), 200));
  const term = q.trim();
  if (term && rule.search.length > 0) {
    const safe = term.slice(0, 60).replace(/[%,()]/g, " ");
    query = query.or(rule.search.map((c) => `${c}.ilike.%${safe}%`).join(","));
  }
  const { data, error } = await query;
  if (error) throw new Error(`Could not load the rows: ${error.message}`);
  return data || [];
}

export async function getRow(table: string, key: string) {
  const rule = ruleFor(table);
  const { data, error } = await db().from(table).select("*").eq(rule.key, key).maybeSingle();
  if (error) throw new Error(`Could not load the row: ${error.message}`);
  if (!data) throw new Error("That record was not found.");
  return data;
}

export async function createRow(actor: string, table: string, fields: Record<string, unknown>, reason: unknown) {
  const reasonProblem = validateReason(reason);
  if (reasonProblem) throw new Error(reasonProblem);
  const check = allowedFields(table, fields);
  if (!check.ok) throw new Error(check.error);
  const { data, error } = await db().from(table).insert(check.fields).select("*").single();
  if (error) throw new Error(`The record could not be added: ${error.message}`);
  const rule = ruleFor(table);
  const key = String((data as Record<string, unknown>)[rule.key]);
  await writeLog(actor, "create", table, key, null, data, String(reason).trim());
  return data;
}

export async function updateRow(actor: string, table: string, key: string, fields: Record<string, unknown>, reason: unknown) {
  const reasonProblem = validateReason(reason);
  if (reasonProblem) throw new Error(reasonProblem);
  const check = allowedFields(table, fields);
  if (!check.ok) throw new Error(check.error);
  const before = await getRow(table, key);
  const rule = ruleFor(table);
  const { data, error } = await db().from(table).update(check.fields).eq(rule.key, key).select("*").single();
  if (error) throw new Error(`The change could not be saved: ${error.message}`);
  const picked = (obj: Record<string, unknown>) => Object.fromEntries(Object.keys(check.fields).map((k) => [k, obj[k]]));
  await writeLog(actor, "update", table, key, picked(before as Record<string, unknown>), picked(data as Record<string, unknown>), String(reason).trim());
  return data;
}

export async function deactivateRow(actor: string, table: string, key: string, reason: unknown) {
  const rule = ruleFor(table);
  if (!rule.active) throw new Error("This table has no active or inactive status.");
  const reasonProblem = validateReason(reason);
  if (reasonProblem) throw new Error(reasonProblem);
  const before = await getRow(table, key);
  const { data, error } = await db().from(table).update({ [rule.active.column]: rule.active.off }).eq(rule.key, key).select("*").single();
  if (error) throw new Error(`The row could not be deactivated: ${error.message}`);
  await writeLog(actor, "deactivate", table, key, { [rule.active.column]: (before as Record<string, unknown>)[rule.active.column] }, { [rule.active.column]: rule.active.off }, String(reason).trim());
  return data;
}

/** Deletes a row only when nothing in the database refers to it. Otherwise the admin is told what refers to it. */
export async function deleteRow(actor: string, table: string, key: string, reason: unknown) {
  const reasonProblem = validateReason(reason);
  if (reasonProblem) throw new Error(reasonProblem);
  const rule = ruleFor(table);
  const before = await getRow(table, key);
  const { data: refs, error: refError } = await db().rpc("admin_referencing_rows", { p_table: table, p_key: key });
  if (refError) throw new Error(`Could not check what refers to this record: ${refError.message}`);
  if (Array.isArray(refs) && refs.length > 0) {
    const list = refs.map((r: { ref_table: string; ref_column: string; ref_count: number }) => `${r.ref_count} in ${r.ref_table} (${r.ref_column})`).join("; ");
    throw new Error(`This record is still used: ${list}. Deactivate it instead, or move those records first.`);
  }
  const { error } = await db().from(table).delete().eq(rule.key, key);
  if (error) throw new Error(`The record could not be deleted: ${error.message}`);
  await writeLog(actor, "delete", table, key, before, null, String(reason).trim());
  return { success: true };
}

export async function changeLog(table: string | undefined, key: string | undefined, limit: number) {
  let query = db().from("admin_change_log").select("*").order("created_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 300));
  if (table) query = query.eq("table_name", table);
  if (key) query = query.eq("record_key", key);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load the log: ${error.message}`);
  return data || [];
}

const IMPORT_LIMIT = 2000;

/** Every row of a table as CSV, with the columns the editor shows for it. */
export async function exportCsv(table: string): Promise<string> {
  const rule = ruleFor(table);
  const uniqueHeaders = [...new Set([rule.match, ...rule.editable])];
  const { data, error } = await db().from(table).select(uniqueHeaders.join(",")).limit(IMPORT_LIMIT);
  if (error) throw new Error(`Could not export: ${error.message}`);
  return toCsv(uniqueHeaders, (data || []) as Record<string, unknown>[]);
}

export interface ImportRow { line: number; action: "create" | "update" | "error"; key: string; fields: Record<string, unknown>; error?: string }

/** Checks a spreadsheet against the table without saving anything. mapping = { spreadsheet column: table field }. */
export async function previewImport(table: string, csvText: string, mapping: Record<string, string>): Promise<{ rows: ImportRow[]; errors: number }> {
  const rule = ruleFor(table);
  const parsed = parseCsv(csvText);
  if (parsed.length < 2) throw new Error("The file needs a header row and at least one data row.");
  if (parsed.length - 1 > IMPORT_LIMIT) throw new Error(`Import at most ${IMPORT_LIMIT} rows at a time.`);
  const header = parsed[0].map((h) => h.trim());
  const matchCol = Object.keys(mapping).find((c) => mapping[c] === rule.match);
  if (!matchCol) throw new Error(`Map a spreadsheet column to "${rule.match}", which identifies each row.`);
  const seen = new Set<string>();
  const out: ImportRow[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const line = i + 1;
    const values = Object.fromEntries(header.map((h, idx) => [h, (parsed[i][idx] ?? "").trim()]));
    const fields: Record<string, unknown> = {};
    for (const [col, field] of Object.entries(mapping)) {
      if (!header.includes(col) || field === rule.match) continue;
      fields[field] = values[col] === "" ? null : values[col];
    }
    const key = values[matchCol] || "";
    if (!key) { out.push({ line, action: "error", key, fields, error: "Missing identifier" }); continue; }
    if (seen.has(key)) { out.push({ line, action: "error", key, fields, error: "Repeated in the file" }); continue; }
    seen.add(key);
    const check = Object.keys(fields).length ? allowedFields(table, fields) : { ok: true as const, fields: {} };
    if (!check.ok) { out.push({ line, action: "error", key, fields, error: check.error }); continue; }
    const { data } = await db().from(table).select(rule.key).eq(rule.match, key).maybeSingle();
    if (data) out.push({ line, action: "update", key, fields });
    else if (rule.importCreate) out.push({ line, action: "create", key, fields: { ...fields, [rule.match]: key } });
    else out.push({ line, action: "error", key, fields, error: "Not found. This table only updates existing records." });
  }
  return { rows: out, errors: out.filter((r) => r.action === "error").length };
}

/** Applies a checked import. Refuses if any row has an error. Every row is logged with the reason and the batch. */
export async function commitImport(actor: string, table: string, csvText: string, mapping: Record<string, string>, reason: unknown) {
  const reasonProblem = validateReason(reason);
  if (reasonProblem) throw new Error(reasonProblem);
  const preview = await previewImport(table, csvText, mapping);
  if (preview.errors > 0) {
    const first = preview.rows.filter((r) => r.action === "error").slice(0, 5).map((r) => `line ${r.line}: ${r.error}`).join("; ");
    throw new Error(`The file has ${preview.errors} error(s), so nothing was saved. ${first}`);
  }
  const batch = `import-${Date.now()}`;
  const why = `${String(reason).trim()} [${batch}]`;
  const rule = ruleFor(table);
  let created = 0, updated = 0;
  for (const row of preview.rows) {
    if (row.action === "create") {
      await createRow(actor, table, row.fields, why);
      created++;
    } else {
      const { data } = await db().from(table).select(rule.key).eq(rule.match, row.key).maybeSingle();
      await updateRow(actor, table, String((data as Record<string, unknown>)[rule.key]), row.fields, why);
      updated++;
    }
  }
  return { success: true, batch, created, updated };
}
