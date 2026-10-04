import { getSupabase } from "../db/supabaseClient.js";

export async function getReceipts(studentRowId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("receipts")
    .select("receipt_number, amount, method, date, received_by, previous_balance, new_balance")
    .eq("student_row_id", studentRowId)
    .order("date", { ascending: false });
  if (error) throw new Error(`getReceipts failed: ${error.message}`);
  return data;
}

export async function getProfile(studentRowId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("students")
    .select("student_id, full_name, phone, email, programme, academic_year, level, status")
    .eq("id", studentRowId)
    .maybeSingle();
  if (error) throw new Error(`getProfile failed: ${error.message}`);
  return data;
}

/** Classes this student is enrolled in — student_ids is a uuid[] column,
 *  so this uses Postgres array-contains rather than a join table. */
async function getEnrolledClasses(studentRowId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("classes")
    .select("id, course_id, instructor_name")
    .contains("student_ids", [studentRowId]);
  if (error) throw new Error(`getEnrolledClasses failed: ${error.message}`);
  return data || [];
}

async function getCourseNamesByIds(courseIds: string[]) {
  if (courseIds.length === 0) return new Map<string, { code: string; name: string; credit_units: number }>();
  const supabase = getSupabase();
  const { data, error } = await supabase.from("courses").select("id, code, name, credit_units").in("id", courseIds);
  if (error) throw new Error(`getCourseNamesByIds failed: ${error.message}`);
  const map = new Map<string, { code: string; name: string; credit_units: number }>();
  for (const c of data || []) map.set(c.id, { code: c.code, name: c.name, credit_units: Number(c.credit_units) });
  return map;
}

export async function getTimetable(studentRowId: string) {
  const supabase = getSupabase();
  const classes = await getEnrolledClasses(studentRowId);
  if (classes.length === 0) return [];

  const classIds = classes.map((c) => c.id);
  const courseMap = await getCourseNamesByIds(classes.map((c) => c.course_id));

  const { data: slots, error } = await supabase
    .from("timetable_slots")
    .select("class_id, day_of_week, start_time, end_time, room")
    .in("class_id", classIds);
  if (error) throw new Error(`getTimetable failed: ${error.message}`);

  const classById = new Map(classes.map((c) => [c.id, c]));
  return (slots || []).map((slot) => {
    const cls = classById.get(slot.class_id);
    const course = cls ? courseMap.get(cls.course_id) : undefined;
    return {
      dayOfWeek: slot.day_of_week,
      startTime: slot.start_time,
      endTime: slot.end_time,
      room: slot.room,
      courseCode: course?.code || "",
      courseName: course?.name || "Unknown course",
      instructorName: cls?.instructor_name || "",
    };
  });
}

export async function getAttendance(studentRowId: string) {
  const supabase = getSupabase();
  const classes = await getEnrolledClasses(studentRowId);
  const courseMap = await getCourseNamesByIds(classes.map((c) => c.course_id));
  const classById = new Map(classes.map((c) => [c.id, c]));

  const { data, error } = await supabase
    .from("attendance_records")
    .select("class_id, date, mark")
    .eq("student_row_id", studentRowId)
    .order("date", { ascending: false });
  if (error) throw new Error(`getAttendance failed: ${error.message}`);

  return (data || []).map((rec) => {
    const cls = classById.get(rec.class_id);
    const course = cls ? courseMap.get(cls.course_id) : undefined;
    return { date: rec.date, mark: rec.mark, courseName: course?.name || "Unknown course" };
  });
}

/** Only returns marks for classes whose result_batches.status is
 *  'published' — draft/pending_review results are never shown to
 *  students, matching the intended review workflow. */
export async function getResults(studentRowId: string) {
  const supabase = getSupabase();
  const classes = await getEnrolledClasses(studentRowId);
  if (classes.length === 0) return [];

  const classIds = classes.map((c) => c.id);
  const courseMap = await getCourseNamesByIds(classes.map((c) => c.course_id));
  const classById = new Map(classes.map((c) => [c.id, c]));

  const { data: publishedBatches, error: batchError } = await supabase
    .from("result_batches")
    .select("class_id")
    .in("class_id", classIds)
    .eq("status", "published");
  if (batchError) throw new Error(`getResults (batches) failed: ${batchError.message}`);

  const publishedClassIds = (publishedBatches || []).map((b) => b.class_id);
  if (publishedClassIds.length === 0) return [];

  const { data: marks, error: marksError } = await supabase
    .from("marks")
    .select("class_id, assessment_item_id, score")
    .eq("student_row_id", studentRowId)
    .in("class_id", publishedClassIds);
  if (marksError) throw new Error(`getResults (marks) failed: ${marksError.message}`);

  const assessmentIds = (marks || []).map((m) => m.assessment_item_id);
  const { data: assessments, error: assessError } = assessmentIds.length
    ? await supabase.from("assessment_items").select("id, name, max_score").in("id", assessmentIds)
    : { data: [] as { id: string; name: string; max_score: number }[], error: null };
  if (assessError) throw new Error(`getResults (assessments) failed: ${assessError.message}`);
  const assessmentById = new Map((assessments || []).map((a) => [a.id, a]));

  return (marks || []).map((m) => {
    const cls = classById.get(m.class_id);
    const course = cls ? courseMap.get(cls.course_id) : undefined;
    const assessment = assessmentById.get(m.assessment_item_id);
    return {
      courseName: course?.name || "Unknown course",
      assessmentName: assessment?.name || "Assessment",
      score: m.score,
      maxScore: assessment?.max_score ?? null,
    };
  });
}

/** Overall GPA (not split by semester — the schema tracks academic_year per
 *  class but not a clean "current semester" concept, so this is one
 *  credit-weighted average across every published class, not the plan's
 *  separate Semester GPA + CGPA. Standard 4.0 scale. A class only counts
 *  once every assessment item that has been entered is weighed in — a
 *  student with some items still ungraded gets a percentage from whatever
 *  marks exist, which is a reasonable "as of now" figure since the class
 *  wouldn't be published at all if grading were nowhere near done. */
export interface CourseResult {
  courseCode: string;
  courseName: string;
  percentage: number;
  gradePoint: number;
  letterGrade: string;
  creditUnits: number;
}

/** The actual per-course computation, shared by getGpaSummary and the
 *  result-slip PDF (resultSlipService.ts) so the two can't ever disagree on
 *  a student's grades. See getGpaSummary's own comment for the scoping
 *  notes (single overall GPA, ungraded items excluded not zeroed, etc). */
export async function getCourseResults(studentRowId: string): Promise<CourseResult[]> {
  const supabase = getSupabase();
  const classes = await getEnrolledClasses(studentRowId);
  if (classes.length === 0) return [];

  const classIds = classes.map((c) => c.id);
  const courseMap = await getCourseNamesByIds(classes.map((c) => c.course_id));

  const { data: publishedBatches, error: batchError } = await supabase
    .from("result_batches").select("class_id").in("class_id", classIds).eq("status", "published");
  if (batchError) throw new Error(`getCourseResults (batches) failed: ${batchError.message}`);
  const publishedClassIds = (publishedBatches || []).map((b) => b.class_id);
  if (publishedClassIds.length === 0) return [];

  const [{ data: allMarks, error: marksError }, { data: allItems, error: itemsError }] = await Promise.all([
    supabase.from("marks").select("class_id, assessment_item_id, score").eq("student_row_id", studentRowId).in("class_id", publishedClassIds),
    supabase.from("assessment_items").select("id, class_id, max_score, weight").in("class_id", publishedClassIds),
  ]);
  if (marksError) throw new Error(`getCourseResults (marks) failed: ${marksError.message}`);
  if (itemsError) throw new Error(`getCourseResults (items) failed: ${itemsError.message}`);

  const courses: CourseResult[] = [];
  for (const classId of publishedClassIds) {
    const cls = classes.find((c) => c.id === classId);
    if (!cls) continue;
    const course = courseMap.get(cls.course_id);
    const items = (allItems || []).filter((i) => i.class_id === classId);
    const marksForClass = (allMarks || []).filter((m) => m.class_id === classId);
    if (items.length === 0 || marksForClass.length === 0) continue;

    let earnedWeight = 0;
    let possibleWeight = 0;
    for (const item of items) {
      const mark = marksForClass.find((m) => m.assessment_item_id === item.id);
      if (!mark) continue; // not graded yet — excluded, not zeroed
      earnedWeight += (Number(mark.score) / Number(item.max_score)) * Number(item.weight);
      possibleWeight += Number(item.weight);
    }
    if (possibleWeight === 0) continue;
    const percentage = (earnedWeight / possibleWeight) * 100;
    const { gradePoint, letterGrade } = percentageToGrade(percentage);

    courses.push({
      courseCode: course?.code || "",
      courseName: course?.name || "Unknown course",
      percentage: Math.round(percentage * 10) / 10,
      gradePoint,
      letterGrade,
      creditUnits: course?.credit_units || 0,
    });
  }
  return courses;
}

/** Overall GPA (not split by semester — the schema tracks academic_year per
 *  class but not a clean "current semester" concept, so this is one
 *  credit-weighted average across every published class, not the plan's
 *  separate Semester GPA + CGPA. Standard 4.0 scale. A class only counts
 *  once every assessment item that has been entered is weighed in — a
 *  student with some items still ungraded gets a percentage from whatever
 *  marks exist, which is a reasonable "as of now" figure since the class
 *  wouldn't be published at all if grading were nowhere near done. */
export async function getGpaSummary(studentRowId: string) {
  const courses = await getCourseResults(studentRowId);
  if (courses.length === 0) return { courses: [], gpa: null as number | null };

  let creditWeightedSum = 0;
  let totalCredits = 0;
  for (const c of courses) {
    creditWeightedSum += c.gradePoint * c.creditUnits;
    totalCredits += c.creditUnits;
  }
  const gpa = totalCredits > 0 ? Math.round((creditWeightedSum / totalCredits) * 100) / 100 : null;
  return { courses: courses.map((c) => ({ courseName: c.courseName, percentage: c.percentage, gradePoint: c.gradePoint, letterGrade: c.letterGrade, creditUnits: c.creditUnits })), gpa };
}

export function percentageToGrade(pct: number): { gradePoint: number; letterGrade: string } {
  if (pct >= 80) return { gradePoint: 4.0, letterGrade: "A" };
  if (pct >= 70) return { gradePoint: 3.5, letterGrade: "B+" };
  if (pct >= 60) return { gradePoint: 3.0, letterGrade: "B" };
  if (pct >= 50) return { gradePoint: 2.5, letterGrade: "C+" };
  if (pct >= 45) return { gradePoint: 2.0, letterGrade: "C" };
  if (pct >= 40) return { gradePoint: 1.0, letterGrade: "D" };
  return { gradePoint: 0.0, letterGrade: "F" };
}

export async function getLetters(studentRowId: string) {
  const supabase = getSupabase();
  const { data: acceptance, error } = await supabase
    .from("acceptance_letters")
    .select("offer_letter_id, generated_at, student_id_number")
    .eq("student_row_id", studentRowId);
  if (error) throw new Error(`getLetters failed: ${error.message}`);
  if (!acceptance || acceptance.length === 0) return [];

  const offerIds = acceptance.map((a) => a.offer_letter_id);
  const { data: offers, error: offerError } = await supabase
    .from("offer_letters")
    .select("id, student_name, programme, academic_year, admission_conditions, fees_amount, reporting_date, authorized_signatory")
    .in("id", offerIds);
  if (offerError) throw new Error(`getLetters (offers) failed: ${offerError.message}`);
  const offerById = new Map((offers || []).map((o) => [o.id, o]));

  return acceptance.map((a) => {
    const offer = offerById.get(a.offer_letter_id);
    return {
      generatedAt: a.generated_at,
      studentName: offer?.student_name || "",
      programme: offer?.programme || "",
      academicYear: offer?.academic_year || "",
      admissionConditions: offer?.admission_conditions || "",
      feesAmount: offer?.fees_amount ?? 0,
      reportingDate: offer?.reporting_date || "",
      authorizedSignatory: offer?.authorized_signatory || "",
    };
  });
}
