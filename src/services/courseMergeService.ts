import { getSupabase } from "../db/supabaseClient.js";
import { validateReason } from "./adminDataPolicy.js";

/** Moves everything that refers to a duplicate course to the course to keep, then removes the duplicate.
 *  Done in one database step, so a failure leaves both courses exactly as they were. Logged with the reason. */
export async function mergeCourses(admin: string, fromId: string, intoId: string, reason: unknown) {
  const reasonProblem = validateReason(reason);
  if (reasonProblem) throw new Error(reasonProblem);
  if (!fromId || !intoId) throw new Error("Choose the duplicate course and the course to keep.");
  if (fromId === intoId) throw new Error("Choose two different courses.");
  const supabase = getSupabase();
  const { data: both, error: lookErr } = await supabase.from("courses").select("id, code, name").in("id", [fromId, intoId]);
  if (lookErr) throw new Error(`Could not load the courses: ${lookErr.message}`);
  if (!both || both.length !== 2) throw new Error("One of the courses was not found.");
  const { data, error } = await supabase.rpc("admin_merge_references", { p_table: "courses", p_from: fromId, p_into: intoId });
  if (error) throw new Error(`The courses could not be merged, so nothing was changed: ${error.message}`);
  const moved = (Array.isArray(data) ? data : []).filter((r: { moved: number }) => r.moved > 0);
  const from = both.find((c: { id: string }) => c.id === fromId) as { code: string; name: string };
  const into = both.find((c: { id: string }) => c.id === intoId) as { code: string; name: string };
  await supabase.from("admin_change_log").insert({
    actor: admin, action: "course.merge", table_name: "courses", record_key: fromId,
    old_values: { code: from.code, name: from.name }, new_values: { merged_into: intoId, code: into.code, name: into.name },
    reason: String(reason).trim(),
  });
  return { success: true, merged: { code: from.code, into: into.code }, moved };
}
