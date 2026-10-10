import { getSupabase } from "../db/supabaseClient.js";

/** Academic setup masters: programmes, levels, semesters, and applicant
 *  programme requests. Every academic form (courses, classes, payment plans,
 *  registration) picks from these lists. "Other" in a form goes through the
 *  create functions below, which are idempotent: asking for a name that
 *  already exists returns the existing record rather than a duplicate. */

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
// Escape LIKE wildcards so a typed "%" or "_" matches literally, not as a pattern.
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface Created<T> { record: T; created: boolean }

// ---- lookups (case-insensitive exact match) ----

export async function findProgrammeByName(name: string) {
  const { data, error } = await getSupabase()
    .from("programmes").select("id, name, department, category, duration_years, duration_label")
    .ilike("name", escapeLike(clean(name))).maybeSingle();
  if (error) throw new Error(`findProgrammeByName failed: ${error.message}`);
  return data;
}

export async function findLevelByName(name: string) {
  const { data, error } = await getSupabase()
    .from("academic_levels").select("id, name").ilike("name", escapeLike(clean(name))).maybeSingle();
  if (error) throw new Error(`findLevelByName failed: ${error.message}`);
  return data;
}

export async function findSemesterByName(name: string) {
  const { data, error } = await getSupabase()
    .from("semesters").select("id, name").ilike("name", escapeLike(clean(name))).maybeSingle();
  if (error) throw new Error(`findSemesterByName failed: ${error.message}`);
  return data;
}

// ---- reads ----

export async function getAcademicSetup() {
  const supabase = getSupabase();
  const [programmes, levels, semesters, requests] = await Promise.all([
    supabase.from("programmes").select("id, name, department, category, duration_years, duration_label").order("name", { ascending: true }),
    supabase.from("academic_levels").select("id, name, sort_order").order("sort_order", { ascending: true }),
    supabase.from("semesters").select("id, name, sort_order").order("sort_order", { ascending: true }),
    supabase.from("programme_requests").select("id, programme_name, application_id, created_at")
      .eq("status", "open").order("created_at", { ascending: false }),
  ]);
  for (const r of [programmes, levels, semesters, requests]) {
    if (r.error) throw new Error(`getAcademicSetup failed: ${r.error.message}`);
  }
  return {
    programmes: programmes.data || [],
    levels: levels.data || [],
    semesters: semesters.data || [],
    programmeRequests: requests.data || [],
  };
}

// ---- creates (idempotent) ----

export async function createProgramme(input: {
  name: string; durationYears: number; category?: string; department?: string;
}): Promise<Created<unknown>> {
  const name = clean(input.name);
  if (!name) throw new Error("Programme name is required.");
  if (name.length > 120) throw new Error("Programme name must be 120 characters or fewer.");
  if (!Number.isFinite(input.durationYears) || input.durationYears <= 0 || input.durationYears > 10) {
    throw new Error("Duration must be between 1 and 10 years.");
  }

  const existing = await findProgrammeByName(name);
  if (existing) return { record: existing, created: false };

  const { data, error } = await getSupabase().from("programmes")
    .insert({
      name,
      department: clean(input.department || ""),
      category: clean(input.category || "") || "General",
      duration_years: input.durationYears,
    })
    .select("id, name, department, category, duration_years, duration_label").single();
  if (error) {
    // A concurrent request may have inserted the same name between the check and the insert.
    if (error.code === "23505") {
      const raced = await findProgrammeByName(name);
      if (raced) return { record: raced, created: false };
    }
    throw new Error(`createProgramme failed: ${error.message}`);
  }
  return { record: data, created: true };
}

export async function createLevel(rawName: string): Promise<Created<unknown>> {
  const name = clean(rawName);
  if (!name) throw new Error("Level name is required.");
  if (name.length > 40) throw new Error("Level name must be 40 characters or fewer.");
  const existing = await findLevelByName(name);
  if (existing) return { record: existing, created: false };
  const { data, error } = await getSupabase().from("academic_levels").insert({ name }).select("id, name, sort_order").single();
  if (error) {
    if (error.code === "23505") { const raced = await findLevelByName(name); if (raced) return { record: raced, created: false }; }
    throw new Error(`createLevel failed: ${error.message}`);
  }
  return { record: data, created: true };
}

export async function createSemester(rawName: string): Promise<Created<unknown>> {
  const name = clean(rawName);
  if (!name) throw new Error("Semester name is required.");
  if (name.length > 40) throw new Error("Semester name must be 40 characters or fewer.");
  const existing = await findSemesterByName(name);
  if (existing) return { record: existing, created: false };
  const { data, error } = await getSupabase().from("semesters").insert({ name }).select("id, name, sort_order").single();
  if (error) {
    if (error.code === "23505") { const raced = await findSemesterByName(name); if (raced) return { record: raced, created: false }; }
    throw new Error(`createSemester failed: ${error.message}`);
  }
  return { record: data, created: true };
}

// ---- applicant programme requests ----

/** Called by the public application form. A programme that's already on the
 *  list needs nothing. An unknown one is queued for the admin — once per name,
 *  so ten applicants typing the same unlisted programme produce one request.
 *  Never throws: the application itself must succeed even if this bookkeeping fails. */
export async function recordProgrammeRequestIfUnknown(programmeName: string, applicationId: string) {
  try {
    const name = clean(programmeName);
    if (!name) return { recorded: false };
    if (await findProgrammeByName(name)) return { recorded: false };

    const supabase = getSupabase();
    const { data: open, error: openErr } = await supabase.from("programme_requests")
      .select("id").ilike("programme_name", escapeLike(name)).eq("status", "open").maybeSingle();
    if (openErr) throw new Error(openErr.message);
    if (open) return { recorded: false };

    const { error } = await supabase.from("programme_requests")
      .insert({ programme_name: name, application_id: applicationId });
    if (error) throw new Error(error.message);
    return { recorded: true };
  } catch (err) {
    console.error("[programmeRequest] could not record request:", (err as Error).message);
    return { recorded: false };
  }
}

export async function approveProgrammeRequest(
  requestId: string, input: { durationYears: number; category?: string; department?: string },
) {
  const supabase = getSupabase();
  const { data: req, error } = await supabase.from("programme_requests")
    .select("id, programme_name, status").eq("id", requestId).maybeSingle();
  if (error) throw new Error(`approveProgrammeRequest (lookup) failed: ${error.message}`);
  if (!req) throw new Error("Request not found.");
  if (req.status !== "open") throw new Error("This request has already been decided.");

  const result = await createProgramme({
    name: req.programme_name,
    durationYears: input.durationYears,
    category: input.category,
    department: input.department,
  });
  const { error: updateError } = await supabase.from("programme_requests")
    .update({ status: "approved" }).eq("id", requestId).eq("status", "open");
  if (updateError) throw new Error(`approveProgrammeRequest (update) failed: ${updateError.message}`);
  return result;
}

export async function rejectProgrammeRequest(requestId: string) {
  const supabase = getSupabase();
  const { data: req, error } = await supabase.from("programme_requests")
    .select("id, status").eq("id", requestId).maybeSingle();
  if (error) throw new Error(`rejectProgrammeRequest (lookup) failed: ${error.message}`);
  if (!req) throw new Error("Request not found.");
  if (req.status !== "open") throw new Error("This request has already been decided.");
  const { error: updateError } = await supabase.from("programme_requests")
    .update({ status: "rejected" }).eq("id", requestId).eq("status", "open");
  if (updateError) throw new Error(`rejectProgrammeRequest failed: ${updateError.message}`);
  return { success: true };
}
