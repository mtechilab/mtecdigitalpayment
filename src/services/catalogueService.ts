import { getSupabase } from "../db/supabaseClient.js";
import { thumbnailLink } from "./newsService.js";

interface ProgrammeRow {
  id: string; name: string; department: string; duration_years: number; duration_label: string; category: string;
  mode: string; description: string; thumbnail_path: string | null; active: boolean;
}

/** Programmes with their prices and thumbnails. The fee shown is the semester fee students pay. */
async function catalogue(includeInactive: boolean) {
  const supabase = getSupabase();
  let query = supabase.from("programmes")
    .select("id, name, department, duration_years, duration_label, category, mode, description, thumbnail_path, active")
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
      durationYears: p.duration_years,
      durationLabel: p.duration_label || `${p.duration_years} ${p.duration_years === 1 ? "Year" : "Years"}`,
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
