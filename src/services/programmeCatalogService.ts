import { getSupabase } from "../db/supabaseClient.js";
import { Database } from "../db/types.js";

type ProgrammeRow = Database["public"]["Tables"]["programmes"]["Row"];

/** Public catalogue shape — what pre-login screens (Home, Courses) render.
 *  Fee amounts are deliberately NOT included: this endpoint is unauthenticated,
 *  and the list doesn't need them. Fees stay behind the student/admin routes. */
export interface PublicProgramme {
  id: string;
  name: string;
  category: string;
  duration: string;
  mode: string;
  description: string;
  intakeLabel: string;
}

function formatDuration(years: number, label: string): string {
  if (label && label.trim()) return label.trim();
  return years === 1 ? "1 Year" : `${years} Years`;
}

export async function getPublicProgrammes(): Promise<PublicProgramme[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("programmes")
    .select("id, name, department, duration_years, duration_label, category, mode, description, intake_label")
    .order("name", { ascending: true });
  if (error) throw new Error(`getPublicProgrammes failed: ${error.message}`);

  const rows = (data || []) as ProgrammeRow[];
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    // Fall back to the department when the catalogue category hasn't been set.
    category: p.category && p.category !== "General" ? p.category : p.department,
    duration: formatDuration(Number(p.duration_years), p.duration_label),
    mode: p.mode,
    description: p.description,
    intakeLabel: p.intake_label,
  }));
}
