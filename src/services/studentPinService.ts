import { randomInt } from "crypto";
import { getSupabase } from "../db/supabaseClient.js";
import { recordAudit } from "./auditLogService.js";
import { validateReason } from "./adminDataPolicy.js";

/** Admin: give a student a new PIN. The PIN is generated, shown once to the admin, and never written to the log. */
export async function resetStudentPin(admin: string, studentRowId: string, reason: unknown) {
  const reasonProblem = validateReason(reason);
  if (reasonProblem) throw new Error(reasonProblem);
  const supabase = getSupabase();
  const { data: student, error: lookupErr } = await supabase.from("students").select("id, student_id, full_name, status")
    .eq("id", studentRowId).maybeSingle();
  if (lookupErr) throw new Error(`Could not load the student: ${lookupErr.message}`);
  if (!student) throw new Error("Student not found.");
  const s = student as unknown as { id: string; student_id: string; full_name: string; status: string };
  const pin = String(randomInt(100000, 1000000));
  const { error } = await supabase.from("students").update({ student_pin: pin }).eq("id", studentRowId);
  if (error) throw new Error(`The PIN could not be reset: ${error.message}`);
  await recordAudit({ actor: admin, action: "student.pin_reset", entityType: "student", entityId: studentRowId,
    detail: { reason: String(reason).trim() } });
  return { studentId: s.student_id, fullName: s.full_name, pin };
}
