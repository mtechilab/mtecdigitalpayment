import { getSupabase } from "../db/supabaseClient.js";

async function generateApplicationNumber(academicYear: string): Promise<string> {
  const supabase = getSupabase();
  const year = academicYear.match(/\d{4}/)?.[0] || new Date().getFullYear().toString();
  const { count, error } = await supabase
    .from("applications").select("id", { count: "exact", head: true }).like("application_number", `MTEC-APP-${year}-%`);
  if (error) throw new Error(`generateApplicationNumber count failed: ${error.message}`);
  const sequence = (count || 0) + 1;
  return `MTEC-APP-${year}-${sequence.toString().padStart(4, "0")}`;
}

export interface SubmitApplicationParams {
  fullName: string;
  phone: string;
  email: string;
  programme: string;
  academicYear: string;
  intake: string;
  studyMode: string;
}

export async function submitApplication(params: SubmitApplicationParams): Promise<{ applicationNumber: string }> {
  const supabase = getSupabase();
  const { fullName, phone, email, programme, academicYear, intake, studyMode } = params;

  const { data: pinRow, error: pinErr } = await supabase.from("application_pins").insert({
    pin: "PIN-" + Math.random().toString(36).slice(2, 10),
    academic_year: academicYear,
    intake,
    status: "generated",
    source: "online_application",
    applicant_name: fullName,
    applicant_phone: phone,
    applicant_email: email,
    programme_interest: programme,
  }).select("id").maybeSingle();
  if (pinErr || !pinRow) throw new Error(`submitApplication application_pins insert failed: ${pinErr?.message}`);

  const applicationNumber = await generateApplicationNumber(academicYear);

  const { error: appErr } = await supabase.from("applications").insert({
    application_number: applicationNumber,
    pin_id: pinRow.id,
    status: "submitted",
    full_name: fullName,
    phone,
    email,
    academic_year: academicYear,
    intake,
    programme,
    study_mode: studyMode,
    declaration_confirmed: true,
    submitted_at: new Date().toISOString(),
  });
  if (appErr) throw new Error(`submitApplication applications insert failed: ${appErr.message}`);

  return { applicationNumber };
}
