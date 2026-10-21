import { getSupabase } from "../db/supabaseClient.js";
import { thumbnailLink } from "./newsService.js";

interface ProgrammeRow {
  id: string; name: string; department: string; duration_years: number; duration_label: string; category: string;
  mode: string; description: string; thumbnail_path: string | null; active: boolean;
  course_type: string | null; duration_value: number | null; duration_unit: string | null;
}

const COURSE_TYPE_LABELS: Record<string, string> = { short_course: "Short course", certificate: "Certificate", diploma: "Diploma" };

/** "6 months", "1 year", "2 years": the duration as students read it. */
export function durationText(value: number | null, unit: string | null, fallbackYears: number): string {
  if (value && unit) {
    const word = unit === "months" ? "month" : "year";
    return `${value} ${value === 1 ? word : word + "s"}`;
  }
  return `${fallbackYears} ${fallbackYears === 1 ? "Year" : "Years"}`;
}

/** Programmes with their prices, durations, and thumbnails. The fee shown is the semester fee students pay. */
async function catalogue(includeInactive: boolean) {
  const supabase = getSupabase();
  let query = supabase.from("programmes")
    .select("id, name, department, duration_years, duration_label, category, mode, description, thumbnail_path, active, course_type, duration_value, duration_unit")
    .order("name", { ascending: true });
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw new Error(`catalogue failed: ${error.message}`);
  const programmes = (data || []) as unknown as ProgrammeRow[];
  const { data: fees } = await supabase.from("fee_structures").select("programme, registration_fee, tuition_per_semester");
  const feeByName = new Map(((fees || []) as unknown as { programme: string; registration_fee: number; tuition_per_semester: number }[])
    .map((f) => [f.programme, f]));
  return Promise.all(programmes.map(async (p) => {
    const fee = feeByName.get(p.name);
    return {
      id: p.id, name: p.name, department: p.department, category: p.category, mode: p.mode, description: p.description,
      courseType: p.course_type, courseTypeLabel: p.course_type ? COURSE_TYPE_LABELS[p.course_type] || p.course_type : "",
      durationValue: p.duration_value, durationUnit: p.duration_unit,
      durationYears: p.duration_years,
      durationLabel: durationText(p.duration_value, p.duration_unit, p.duration_years),
      active: p.active,
      registrationFee: fee ? fee.registration_fee : null,
      tuitionPerSemester: fee ? fee.tuition_per_semester : null,
      thumbnailUrl: await thumbnailLink(p.thumbnail_path),
    };
  }));
}

export async function publicCatalogue() {
  return catalogue(false);
}

export async function adminCatalogue() {
  return catalogue(true);
}
