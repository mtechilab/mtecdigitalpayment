import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { validateCheckin, saveOutcome, DEFAULT_MILESTONES } from "./checkinPolicy.js";

export interface Actor { kind: "admin" | "lecturer"; id: string; name: string }
type Loose = { from(t: string): any };
const db = (): Loose => getSupabase() as unknown as Loose;

/** Administrators manage every project. A lecturer manages only the projects they own. */
async function canManage(actor: Actor, projectId: string): Promise<void> {
  if (actor.kind === "admin") return;
  const { data } = await db().from("projects").select("lecturer_staff_id").eq("id", projectId).maybeSingle();
  if (!data) throw new Error("That project was not found.");
  if (data.lecturer_staff_id !== actor.id) throw new Error("You can only change projects you own.");
}

export async function createProject(actor: Actor, input: {
  title: string; description?: string; courseCode?: string; programme?: string; semester: string; academicYear?: string; classId?: string;
}) {
  if (!input.title || input.title.trim().length < 3) throw new Error("The project title must be at least 3 characters.");
  if (!input.semester) throw new Error("Choose the semester.");
  const { data, error } = await db().from("projects").insert({
    title: input.title.trim(), description: (input.description || "").trim(), course_code: input.courseCode || null,
    programme: input.programme || null, semester_name: input.semester, academic_year: input.academicYear || null,
    class_id: input.classId || null, lecturer_staff_id: actor.kind === "lecturer" ? actor.id : null, created_by: actor.name,
  }).select("id").single();
  if (error) throw new Error(`The project could not be created: ${error.message}`);
  const projectId = data.id as string;
  const { error: mErr } = await db().from("project_milestones").insert(
    DEFAULT_MILESTONES.map((title, i) => ({ project_id: projectId, position: i + 1, title })));
  if (mErr) throw new Error(`The milestones could not be created: ${mErr.message}`);
  await recordAudit({ actor: actor.name, action: "project.create", entityType: "project", entityId: projectId, detail: { title: input.title } });
  return { id: projectId };
}

export async function updateProject(actor: Actor, projectId: string, fields: { title?: string; description?: string; semester?: string }) {
  await canManage(actor, projectId);
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.title !== undefined) update.title = fields.title.trim();
  if (fields.description !== undefined) update.description = fields.description.trim();
  if (fields.semester !== undefined) update.semester_name = fields.semester;
  const { error } = await db().from("projects").update(update).eq("id", projectId);
  if (error) throw new Error(`The project could not be updated: ${error.message}`);
  await recordAudit({ actor: actor.name, action: "project.update", entityType: "project", entityId: projectId, detail: { fields: Object.keys(update) } });
  return { success: true };
}

/** A lecturer assigns students to a project. Only active students can be assigned. */
export async function assignStudents(actor: Actor, projectId: string, studentRowIds: string[]) {
  await canManage(actor, projectId);
  if (!Array.isArray(studentRowIds) || studentRowIds.length === 0) throw new Error("Choose at least one student.");
  const { data: found, error: aErr } = await db().from("students").select("id, status").in("id", studentRowIds);
  if (aErr) throw new Error(`Could not check the students: ${aErr.message}`);
  const ok = ((found || []) as { id: string; status: string }[]).filter((s) => s.status === "active").map((s) => s.id);
  if (ok.length !== studentRowIds.length) throw new Error("Some students are missing or not active.");
  const { error } = await db().from("project_members").upsert(
    ok.map((id) => ({ project_id: projectId, student_row_id: id, assigned_by: actor.name })), { onConflict: "project_id,student_row_id" });
  if (error) throw new Error(`The students could not be assigned: ${error.message}`);
  await recordAudit({ actor: actor.name, action: "project.assign", entityType: "project", entityId: projectId, detail: { count: ok.length } });
  return { success: true, assigned: ok.length };
}

/** A student's own active projects. */
export async function myProjects(studentRowId: string) {
  const { data: rows, error } = await db().from("project_members").select("project_id").eq("student_row_id", studentRowId);
  if (error) throw new Error(`Could not load your projects: ${error.message}`);
  const ids = ((rows || []) as { project_id: string }[]).map((r) => r.project_id);
  if (ids.length === 0) return [];
  const { data, error: pErr } = await db().from("projects")
    .select("id, title, description, course_code, semester_name, academic_year, active").in("id", ids).eq("active", true);
  if (pErr) throw new Error(`Could not load your projects: ${pErr.message}`);
  return data || [];
}

/** Saves a weekly check-in. Only a member of the project can save one, and only for themselves. */
export async function saveCheckin(studentRowId: string, input: {
  projectId: string; week: number; semester: string; workCompleted?: string; skillsLearned?: string; challenges?: string; nextPlan?: string;
  submit: boolean; clientReference: string;
}) {
  if (!Number.isInteger(input.week) || input.week < 1 || input.week > 52) throw new Error("Choose a week from 1 to 52.");
  if (!input.clientReference || input.clientReference.length < 8) throw new Error("The save is missing its reference.");
  const problem = validateCheckin(input, input.submit);
  if (problem) throw new Error(problem);
  const { data: member } = await db().from("project_members").select("project_id")
    .eq("project_id", input.projectId).eq("student_row_id", studentRowId).maybeSingle();
  if (!member) throw new Error("You are not assigned to this project.");

  const { data: existing } = await db().from("project_checkins").select("id, status, client_reference")
    .eq("project_id", input.projectId).eq("student_row_id", studentRowId).eq("week_number", input.week).maybeSingle();
  const outcome = saveOutcome(existing ? existing.status : null, input.submit ? "submitted" : "draft",
    !!existing && existing.client_reference === input.clientReference);
  if (outcome === "already_saved") return { id: existing.id, status: existing.status, duplicate: true };
  if (outcome === "refuse") throw new Error(`Week ${input.week} is already submitted. It cannot be changed.`);

  const row = {
    work_completed: input.workCompleted ?? null, skills_learned: input.skillsLearned ?? null,
    challenges: input.challenges ?? null, next_plan: input.nextPlan ?? null,
    status: input.submit ? "submitted" : "draft", semester_name: input.semester,
    submitted_at: input.submit ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  };
  if (outcome === "create") {
    const { data, error } = await db().from("project_checkins").insert({
      ...row, project_id: input.projectId, student_row_id: studentRowId, week_number: input.week, client_reference: input.clientReference,
    }).select("id, status").single();
    if (error) throw new Error(`The check-in could not be saved: ${error.message}`);
    return { id: data.id, status: data.status, duplicate: false };
  }
  const { data, error } = await db().from("project_checkins").update({ ...row, client_reference: input.clientReference })
    .eq("id", existing.id).select("id, status").single();
  if (error) throw new Error(`The check-in could not be saved: ${error.message}`);
  return { id: data.id, status: data.status, duplicate: false };
}

/** A lecturer reads the submitted check-ins for projects they own. Drafts stay with the student. */
export async function lecturerCheckins(actor: Actor, projectId: string) {
  await canManage(actor, projectId);
  const { data, error } = await db().from("project_checkins")
    .select("id, student_row_id, week_number, status, work_completed, skills_learned, challenges, next_plan, submitted_at")
    .eq("project_id", projectId).eq("status", "submitted").order("week_number", { ascending: true });
  if (error) throw new Error(`Could not load the check-ins: ${error.message}`);
  return data || [];
}

/** The project a check-in belongs to, for lecturer access checks. */
export async function checkinProjectOwnedBy(actor: Actor, checkinId: string): Promise<boolean> {
  const { data } = await db().from("project_checkins").select("project_id, status").eq("id", checkinId).maybeSingle();
  if (!data || data.status !== "submitted") return false;
  if (actor.kind === "admin") return true;
  const { data: p } = await db().from("projects").select("lecturer_staff_id").eq("id", data.project_id).maybeSingle();
  return !!p && p.lecturer_staff_id === actor.id;
}
