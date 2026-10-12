import { DuplicateRequestError } from "./errors.js";
import { recordProgrammeRequestIfUnknown } from "./academicSetupService.js";
import { getSupabase } from "../db/supabaseClient.js";

/** The schema's real pipeline is application_pins -> applications, pin_id
 *  a required FK (see schema.sql). A visitor filling out the public form
 *  has no pin yet, so this creates one on the fly with source
 *  'online_application' (migration 004) — immediately marked 'used' since
 *  it's consumed by the application it's about to create, not something
 *  anyone types in separately. */
export interface SubmitApplicationInput {
  fullName: string;
  phone: string;
  email?: string;
  programme: string;
  academicYear: string;
  intake: string;
  studyMode: string;
}

export async function submitApplication(input: SubmitApplicationInput) {
  const supabase = getSupabase();

  // One live application per phone, programme and year. A rejected one doesn't count,
  // so the applicant can apply again after a rejection.
  const { data: existing, error: existingError } = await supabase
    .from("applications")
    .select("id")
    .eq("phone", input.phone.trim())
    .eq("programme", input.programme.trim())
    .eq("academic_year", input.academicYear.trim())
    .neq("status", "rejected")
    .limit(1);
  if (existingError) throw new Error(`submitApplication (duplicate check) failed: ${existingError.message}`);
  if (existing && existing.length > 0) {
    throw new DuplicateRequestError("An application with this phone number for this programme and year already exists. Check your status, or contact admissions.");
  }

  const { data: pin, error: pinError } = await supabase
    .from("application_pins")
    .insert({
      pin: `ONLINE-${Date.now()}`,
      academic_year: input.academicYear,
      intake: input.intake,
      status: "used",
      source: "online_application",
      applicant_name: input.fullName,
      applicant_phone: input.phone,
      applicant_email: input.email || null,
      programme_interest: input.programme,
    })
    .select("id")
    .single();
  if (pinError) throw new Error(`submitApplication (pin) failed: ${pinError.message}`);

  const { data: application, error: appError } = await supabase
    .from("applications")
    .insert({
      application_number: `APP-${Date.now()}`,
      pin_id: pin.id,
      status: "submitted",
      full_name: input.fullName,
      phone: input.phone,
      email: input.email || "",
      academic_year: input.academicYear,
      programme: input.programme,
      intake: input.intake,
      study_mode: input.studyMode,
    })
    .select("id, application_number")
    .single();
  if (appError) throw new Error(`submitApplication (application) failed: ${appError.message}`);

  // A programme typed by an applicant that isn't on the list is queued for the
  // admin. Never blocks the application — the helper swallows its own errors.
  await recordProgrammeRequestIfUnknown(input.programme, application.id);

  return application;
}
