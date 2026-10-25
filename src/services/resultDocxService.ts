import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, PageOrientation } from "docx";
import type { Response } from "express";
import { getSupabase } from "../db/supabaseClient.js";
import { getCourseResults, CourseResult } from "./studentInfoService.js";
import { classifyAward } from "./resultSlipService.js";

const COLLEGE = "MAKENI TECHNICAL COLLEGE OF INNOVATION & TECHNOLOGY";
const ADDRESS = "P.M.B. 12, MAKENI, SIERRA LEONE";

function cell(text: string, bold = false, width?: number): TableCell {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 20 })] })],
  });
}

function gpaOf(courses: CourseResult[]): number {
  let weighted = 0, credits = 0;
  for (const c of courses) { weighted += c.gradePoint * c.creditUnits; credits += c.creditUnits; }
  return credits > 0 ? Math.round((weighted / credits) * 100) / 100 : 0;
}

function collegeHeader(title: string, subtitle: string): Paragraph[] {
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: COLLEGE, bold: true, size: 24 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: ADDRESS, size: 18 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [new TextRun({ text: title, bold: true, size: 30 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: subtitle, size: 20 })] }),
  ];
}

/** One student's result slip as a Word document: the same courses, marks, grades, and summary as the PDF. */
export async function buildStudentResultDocx(studentRowId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const supabase = getSupabase();
  const { data: student, error } = await supabase.from("students")
    .select("full_name, student_id, programme, academic_year, status").eq("id", studentRowId).maybeSingle();
  if (error) throw new Error(`Could not read the student: ${error.message}`);
  if (!student) throw new Error("Student not found.");
  const s = student as unknown as { full_name: string; student_id: string; programme: string; academic_year: string; status: string };
  const courses = await getCourseResults(studentRowId);
  if (courses.length === 0) throw new Error("This student has no published results yet.");
  const gpa = gpaOf(courses);
  const isFinal = s.status === "graduated";

  const rows = [
    new TableRow({ tableHeader: true, children: [cell("COURSE CODE", true, 15), cell("COURSE TITLE", true, 40), cell("CREDIT UNITS", true, 15), cell("MARKS (%)", true, 15), cell("GRADE", true, 15)] }),
    ...courses.map((c) => new TableRow({ children: [
      cell(c.courseCode, false, 15), cell(c.courseName, false, 40), cell(String(c.creditUnits), false, 15),
      cell(String(Math.round(c.percentage * 10) / 10), false, 15), cell(c.letterGrade, false, 15),
    ] })),
  ];

  const doc = new Document({
    sections: [{
      children: [
        ...collegeHeader("ACADEMIC RESULT SLIP", `YEAR: ${s.academic_year}  (${isFinal ? "COMPLETED" : "IN PROGRESS"})`),
        new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: "STUDENT INFORMATION", bold: true, size: 22 })] }),
        new Paragraph({ children: [new TextRun({ text: `NAME: ${s.full_name.toUpperCase()}`, size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: `REGISTRATION NO: ${s.student_id}`, size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: `PROGRAMME: ${s.programme.toUpperCase()}`, size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: `STATUS: ${isFinal ? "FINAL RESULT" : "PROVISIONAL RESULT"}`, size: 20 })] }),
        new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: "RESULT TABLE", bold: true, size: 22 })] }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
        new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: "SUMMARY", bold: true, size: 22 })] }),
        new Paragraph({ children: [new TextRun({ text: `CUMULATIVE GPA (CGPA): ${gpa.toFixed(2)} / 4.00`, size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: `AWARD: ${classifyAward(gpa).toUpperCase()}`, size: 20 })] }),
        new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: "Head of Department: ____________________   Date: __________", size: 20 })] }),
        new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Editable Word copy. The PDF slip is the official print.", italics: true, size: 16 })] }),
      ],
    }],
  });
  return { buffer: await Packer.toBuffer(doc), fileName: `${s.student_id}-result-slip.docx` };
}

/** The master gradesheet for a programme: one row per student, one column per course, with CGPA. */
export async function buildMasterGradesheetDocx(programme: string): Promise<{ buffer: Buffer; fileName: string }> {
  const supabase = getSupabase();
  const { data: students, error } = await supabase.from("students")
    .select("id, student_id, full_name").eq("programme", programme).eq("status", "active")
    .order("student_id", { ascending: true }).limit(200);
  if (error) throw new Error(`Could not read the students: ${error.message}`);
  const list = (students || []) as unknown as { id: string; student_id: string; full_name: string }[];
  if (list.length === 0) throw new Error("No active students are on this programme.");

  const results: { student: typeof list[number]; courses: CourseResult[] }[] = [];
  const codes = new Map<string, string>();
  for (const st of list) {
    const courses = await getCourseResults(st.id);
    for (const c of courses) if (!codes.has(c.courseCode)) codes.set(c.courseCode, c.courseName);
    results.push({ student: st, courses });
  }
  const columns = [...codes.keys()];

  const header = new TableRow({ tableHeader: true, children: [
    cell("REG NO", true), cell("NAME", true), ...columns.map((c) => cell(c, true)), cell("CGPA", true),
  ] });
  const body = results.map(({ student, courses }) => {
    const byCode = new Map(courses.map((c) => [c.courseCode, c.letterGrade]));
    return new TableRow({ children: [
      cell(student.student_id), cell(student.full_name),
      ...columns.map((code) => cell(byCode.get(code) || "-")),
      cell(courses.length ? gpaOf(courses).toFixed(2) : "-"),
    ] });
  });

  const doc = new Document({
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
      children: [
        ...collegeHeader("MASTER GRADESHEET", `PROGRAMME: ${programme.toUpperCase()}`),
        new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: `Students: ${list.length}   Courses: ${columns.length}`, size: 20 })] }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] }),
        new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: "Shows only results that have been published. Students without published results show a dash.", italics: true, size: 16 })] }),
      ],
    }],
  });
  const safe = programme.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40);
  return { buffer: await Packer.toBuffer(doc), fileName: `MasterGradesheet-${safe}.docx` };
}

export function sendDocx(res: Response, buffer: Buffer, fileName: string) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Length", String(buffer.length));
  res.end(buffer);
}
