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

  return application;
}
