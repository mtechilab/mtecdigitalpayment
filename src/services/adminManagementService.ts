import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { validateStudentUpdate, validateProgramme, validateFees, canDeleteStudent } from "./adminManagementPolicy.js";

/** Student details the admin may change. The programme, if changed, must be an active programme. */
export async function updateStudent(admin: string, studentId: string, fields: {
  fullName?: string; phone?: string; email?: string; programme?: string; academicYear?: string; level?: string; status?: string;
}) {
  const problem = validateStudentUpdate(fields);
  if (problem) throw new Error(problem);
  const supabase = getSupabase();
  const update: Record<string, string> = {};
  if (fields.fullName !== undefined) update.full_name = fields.fullName.trim();
  if (fields.phone !== undefined) update.phone = fields.phone.trim();
  if (fields.email !== undefined) update.email = fields.email.trim();
  if (fields.level !== undefined) update.level = fields.level.trim();
  if (fields.academicYear !== undefined) update.academic_year = fields.academicYear.trim();
  if (fields.status !== undefined) update.status = fields.status;
  if (fields.programme !== undefined) {
    const name = fields.programme.trim();
    const { data: programme } = await supabase.from("programmes").select("name, active").eq("name", name).maybeSingle();
    const row = programme as unknown as { name: string; active: boolean } | null;
    if (!row || !row.active) throw new Error("Choose an active programme.");
    update.programme = name;
  }
  if (Object.keys(update).length === 0) throw new Error("Nothing to change.");
  const { data: existing } = await supabase.from("students").select("id").eq("id", studentId).maybeSingle();
  if (!existing) throw new Error("That student was not found.");
  const { error } = await supabase.from("students").update(update).eq("id", studentId);
  if (error) throw new Error(`updateStudent failed: ${error.message}`);
  await recordAudit({ actor: admin, action: "student.update", entityType: "student", entityId: studentId, detail: { fields: Object.keys(update) } });
  return { success: true };
}

/** Deleting is permanent, so it is refused whenever the student has any invoice, plan, submission, or transaction,
 *  or when one of those records cannot be checked. The student is deactivated instead. */
export async function deleteStudent(admin: string, studentId: string) {
  const supabase = getSupabase();
  const tables: { table: string; column: string }[] = [
    { table: "student_invoices", column: "student_row_id" },
    { table: "payment_plans", column: "student_row_id" },
    { table: "payment_submissions", column: "student_row_id" },
    { table: "payment_transactions", column: "student_row_id" },
  ];
  const counts: (number | null)[] = [];
  for (const t of tables) {
    const { count, error } = await supabase.from(t.table).select("id", { count: "exact", head: true }).eq(t.column, studentId);
    counts.push(error ? null : (count ?? 0));
  }
  if (!canDeleteStudent(counts)) {
    throw new Error("This student has payments or records, so they cannot be deleted. Deactivate them instead.");
  }
  const { error } = await supabase.from("students").delete().eq("id", studentId);
  if (error) throw new Error(`deleteStudent failed: ${error.message}`);
  await recordAudit({ actor: admin, action: "student.delete", entityType: "student", entityId: studentId, detail: {} });
  return { success: true };
}

export async function listProgrammes() {
  const { data, error } = await getSupabase().from("programmes")
    .select("id, name, department, duration_years, duration_label, category, mode, description, intake_label, active")
    .order("name", { ascending: true });
  if (error) throw new Error(`listProgrammes failed: ${error.message}`);
  return data || [];
}

export async function addProgramme(admin: string, input: {
  name: string; department?: string; durationYears?: number; durationLabel?: string; category?: string; mode?: string; description?: string; intakeLabel?: string;
}) {
  const problem = validateProgramme(input);
  if (problem) throw new Error(problem);
  const { data, error } = await getSupabase().from("programmes").insert({
    name: input.name.trim(), department: (input.department || "").trim(), duration_years: input.durationYears ?? 1,
    duration_label: (input.durationLabel || "").trim(), category: (input.category || "").trim(), mode: (input.mode || "").trim(),
    description: (input.description || "").trim(), intake_label: (input.intakeLabel || "").trim(), active: true,
  }).select("id").single();
  if (error) throw new Error(`addProgramme failed: ${error.message}`);
  await recordAudit({ actor: admin, action: "programme.add", entityType: "programme", entityId: (data as { id: string }).id, detail: { name: input.name } });
  return { id: (data as { id: string }).id };
}

/** Changing a programme's name is not allowed, since students and fees are linked to it by name. */
export async function updateProgramme(admin: string, id: string, input: {
  department?: string; durationYears?: number; durationLabel?: string; category?: string; mode?: string; description?: string; intakeLabel?: string;
}) {
  const problem = validateProgramme({ name: "ok-name", durationYears: input.durationYears, category: input.category, mode: input.mode });
  if (problem) throw new Error(problem);
  const update: Record<string, unknown> = {};
  if (input.department !== undefined) update.department = input.department.trim();
  if (input.durationYears !== undefined) update.duration_years = input.durationYears;
  if (input.durationLabel !== undefined) update.duration_label = input.durationLabel.trim();
  if (input.category !== undefined) update.category = input.category.trim();
  if (input.mode !== undefined) update.mode = input.mode.trim();
  if (input.description !== undefined) update.description = input.description.trim();
  if (input.intakeLabel !== undefined) update.intake_label = input.intakeLabel.trim();
  if (Object.keys(update).length === 0) throw new Error("Nothing to change.");
  const { error } = await getSupabase().from("programmes").update(update).eq("id", id);
  if (error) throw new Error(`updateProgramme failed: ${error.message}`);
  await recordAudit({ actor: admin, action: "programme.update", entityType: "programme", entityId: id, detail: { fields: Object.keys(update) } });
  return { success: true };
}

/** A deactivated programme is hidden from new applications. Students already on it keep their record. */
export async function setProgrammeActive(admin: string, id: string, active: boolean) {
  const { error } = await getSupabase().from("programmes").update({ active }).eq("id", id);
  if (error) throw new Error(`setProgrammeActive failed: ${error.message}`);
  await recordAudit({ actor: admin, action: active ? "programme.reactivate" : "programme.deactivate", entityType: "programme", entityId: id, detail: {} });
  return { success: true };
}

export async function listFees() {
  const { data, error } = await getSupabase().from("fee_structures")
    .select("programme, registration_fee, tuition_per_semester, updated_at, updated_by").order("programme", { ascending: true });
  if (error) throw new Error(`listFees failed: ${error.message}`);
  return data || [];
}

/** Changing a fee applies to invoices created from now on. Invoices already issued are not changed. */
export async function setFee(admin: string, programme: string, registration: unknown, tuition: unknown) {
  const problem = validateFees(registration, tuition);
  if (problem) throw new Error(problem);
  const supabase = getSupabase();
  const { data: prog } = await supabase.from("programmes").select("name").eq("name", programme).maybeSingle();
  if (!prog) throw new Error("Choose a programme that exists.");
  const { error } = await supabase.from("fee_structures").upsert({
    programme, registration_fee: registration as number, tuition_per_semester: tuition as number,
    updated_at: new Date().toISOString(), updated_by: admin,
  }, { onConflict: "programme" });
  if (error) throw new Error(`setFee failed: ${error.message}`);
  await recordAudit({ actor: admin, action: "fee.set", entityType: "fee_structure", entityId: programme, detail: { registration, tuition } });
  return { success: true };
}
