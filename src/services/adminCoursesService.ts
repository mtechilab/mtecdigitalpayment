import { getSupabase } from "../db/supabaseClient.js";

export interface CreateCourseParams {
  code: string;
  name: string;
  programme: string;
  level: string;
  semester: string;
  creditUnits: number;
}

export async function createCourse(params: CreateCourseParams) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("courses")
    .insert({
      code: params.code,
      name: params.name,
      programme: params.programme,
      level: params.level,
      semester: params.semester,
      credit_units: params.creditUnits,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createCourse failed: ${error.message}`);
  return data;
}
