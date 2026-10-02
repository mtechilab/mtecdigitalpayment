import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import { getSupabase } from "../db/supabaseClient.js";
import { getCourseResults, percentageToGrade } from "./studentInfoService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREST_PATH = path.join(__dirname, "..", "..", "assets", "mtec-crest.png");

/** Standard 4.0-scale classification. Not specified anywhere else in the
 *  system — a reasonable default banding, easy to change in one place if
 *  the college has an official policy that differs. */
function classifyAward(gpa: number): string {
  if (gpa >= 3.6) return "DISTINCTION";
  if (gpa >= 3.0) return "MERIT";
  if (gpa >= 2.0) return "PASS";
  return "NOT CLASSIFIED";
}

/** Streams a PDF result slip straight to the response — no temp file, no
 *  buffering the whole document in memory first. Caller sets nothing else
 *  on `res`; this function owns the headers and the stream lifecycle. */
export async function streamResultSlip(studentRowId: string, res: import("express").Response) {
  const supabase = getSupabase();
  const { data: student, error } = await supabase
    .from("students")
    .select("full_name, student_id, programme, academic_year, status")
    .eq("id", studentRowId)
    .maybeSingle();
  if (error) throw new Error(`streamResultSlip (student lookup) failed: ${error.message}`);
  if (!student) throw new Error("Student not found.");

  const courses = await getCourseResults(studentRowId);
  if (courses.length === 0) throw new Error("This student has no published results yet — there's nothing to put on a slip.");

  let creditWeightedSum = 0;
  let totalCredits = 0;
  for (const c of courses) {
    creditWeightedSum += c.gradePoint * c.creditUnits;
    totalCredits += c.creditUnits;
  }
  const gpa = totalCredits > 0 ? Math.round((creditWeightedSum / totalCredits) * 100) / 100 : 0;
  const award = classifyAward(gpa);
  const isFinal = student.status === "graduated";

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${student.student_id}-result-slip.pdf"`);
  doc.pipe(res);

  // ---- Header: crest + college name/address ----
  try {
    doc.image(CREST_PATH, doc.page.width / 2 - 40, 45, { width: 80 });
  } catch {
    // Missing/unreadable asset shouldn't take the whole slip down — the
    // text content below still makes this a usable document without it.
  }
  doc.fontSize(9).font("Helvetica-Bold")
    .text("MAKENI TECHNICAL COLLEGE OF INNOVATION &\nTECHNOLOGY,", 50, 55, { width: 180 });
  doc.font("Helvetica").text("P.M.B. 12,\nMAKENI,\nSIERRA LEONE", 50, 78, { width: 180 });

  doc.y = 140;
  doc.fontSize(16).font("Helvetica-Bold").text("ACADEMIC RESULT SLIP", { align: "center" });
  doc.fontSize(11).font("Helvetica").text(
    `YEAR: ${student.academic_year}  (${isFinal ? "COMPLETED" : "IN PROGRESS"})`, { align: "center" });
  doc.moveDown(1.2);

  // ---- Student information ----
  doc.fontSize(11).font("Helvetica-Bold").text("STUDENT INFORMATION");
  doc.font("Helvetica").fontSize(10);
  doc.text(`NAME: ${student.full_name.toUpperCase()}`);
  doc.text(`REGISTRATION NO: ${student.student_id}`);
  doc.text(`PROGRAMME: ${student.programme.toUpperCase()}`);
  doc.text(`STATUS: ${isFinal ? "FINAL RESULT" : "PROVISIONAL RESULT"}`);
  doc.moveDown(1);

  // ---- Result table ----
  doc.fontSize(11).font("Helvetica-Bold").text("RESULT TABLE");
  doc.moveDown(0.3);

  const tableX = doc.x;
  const colWidths = [70, 200, 70, 70, 70]; // code, title, credits, marks, grade
  const rowHeight = 22;
  let ty = doc.y;

  const drawRow = (cells: string[], bold: boolean, shaded: boolean) => {
    let cx = tableX;
    if (shaded) doc.rect(tableX, ty, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill("#e8e8e8").fillColor("black");
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
    cells.forEach((cell, i) => {
      doc.rect(cx, ty, colWidths[i], rowHeight).stroke();
      doc.text(cell, cx + 4, ty + 6, { width: colWidths[i] - 8, align: i === 1 ? "left" : "center" });
      cx += colWidths[i];
    });
    ty += rowHeight;
  };

  drawRow(["COURSE\nCODE", "COURSE TITLE", "CREDIT\nUNITS", "MARKS\n(%)", "GRADE"], true, true);
  for (const c of courses) {
    drawRow([c.courseCode, c.courseName, String(c.creditUnits), String(c.percentage), c.letterGrade], false, false);
  }
  doc.y = ty + 14;

  // ---- Summary statistics ----
  doc.fontSize(11).font("Helvetica-Bold").text("SUMMARY STATISTICS");
  doc.font("Helvetica").fontSize(10);
  doc.text(`CUMULATIVE G.P.A. (CGPA): ${gpa.toFixed(2)} / 4.00`);
  doc.text(`AWARD: ${award}`);
  doc.text(`REMARKS: ${isFinal ? "PROGRAMME COMPLETED SUCCESSFULLY" : "RESULTS AS OF DATE OF ISSUE"}`);
  doc.moveDown(1.2);

  // ---- Authorization ----
  doc.fontSize(11).font("Helvetica-Bold").text("AUTHORIZATION");
  doc.moveDown(1.5);
  doc.font("Helvetica").fontSize(10);
  doc.text("____________________________");
  doc.text("HEAD OF DEPARTMENT SIGNATURE & STAMP");
  doc.moveDown(0.8);
  doc.text(`DATE OF ISSUE: ${new Date().toLocaleDateString("en-GB")}`);

  // ---- Footer ----
  doc.fontSize(8).font("Helvetica-Oblique").text(
    "FOR VERIFICATION ONLY — NOT AN OFFICIAL CERTIFICATE",
    50, doc.page.height - 40, { align: "center", width: doc.page.width - 100 });

  doc.end();
}
