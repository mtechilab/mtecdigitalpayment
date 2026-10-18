import PDFDocument from "pdfkit";
import type { Response } from "express";
import { getSupabase } from "../db/supabaseClient.js";

const NAVY = "#0D1B3D";
const LEVELS: Record<string, string> = { certificate: "Certificate", diploma: "Diploma" };
const ENROLL: Record<string, string> = { self_funded: "Self-funded student", sponsored: "Scholarship / sponsored student" };
const STATUS_LABELS: Record<string, string> = { draft: "Draft", submitted: "Submitted", under_review: "Under review", info_required: "More information required", accepted: "Accepted", approved: "Approved (student created)", rejected: "Rejected" };

interface EducationRow { school: string; yearGraduated: string; highestGrade: string; qualification: string; graduated: boolean }

function val(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  return String(v);
}

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.8);
  const y = doc.y;
  doc.rect(56, y, doc.page.width - 112, 20).fill(NAVY);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(11).text(title, 62, y + 5, { width: doc.page.width - 124 });
  doc.fillColor("black").font("Helvetica").fontSize(10);
  doc.y = y + 26;
}

function field(doc: PDFKit.PDFDocument, label: string, value: unknown) {
  doc.font("Helvetica-Bold").fontSize(10).text(label + ": ", { continued: true });
  doc.font("Helvetica").text(val(value));
}

/** The filled application form, in the paper form's order, for the admission record. */
export async function streamApplicationForm(applicationId: string, res: Response) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("applications").select("*").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(`streamApplicationForm failed: ${error.message}`);
  if (!data) throw new Error("That application was not found.");
  const a = data as unknown as Record<string, unknown>;
  const { data: payments } = await supabase.from("application_payments")
    .select("method, amount, reference, status, reviewed_at").eq("application_id", applicationId).order("submitted_at", { ascending: false });
  const list = (payments || []) as unknown as { method: string; amount: number; reference: string | null; status: string }[];
  const verified = list.find((p) => p.status === "verified");
  const education = Array.isArray(a.education) ? (a.education as EducationRow[]) : [];
  const guardian = (a.guardian || {}) as Record<string, string>;

  const doc = new PDFDocument({ size: "A4", margin: 56 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="MTeC-application-${val(a.application_number)}.pdf"`);
  doc.pipe(res);

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(15).text("Makeni Technical College of Innovative Technology");
  doc.fillColor("#555555").font("Helvetica").fontSize(9).text("53 Station Road, opposite the Light Center, Makeni  |  +232 76 866 665  |  mtecsl.info@gmail.com");
  doc.moveDown(0.8);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(17).text("STUDENT APPLICATION FORM");
  doc.fillColor("black").font("Helvetica").fontSize(10);
  field(doc, "Application number", a.application_number);
  field(doc, "Submitted", a.submitted_at ? new Date(String(a.submitted_at)).toLocaleString("en-GB") : "-");
  field(doc, "Status", STATUS_LABELS[String(a.status)] || a.status);
  if (a.student_id) field(doc, "Student ID", a.student_id);

  section(doc, "1. APPLICANT'S INFORMATION");
  field(doc, "Full name", a.full_name);
  field(doc, "Middle name", a.other_name);
  field(doc, "Gender", a.gender);
  field(doc, "Date of birth", a.date_of_birth);
  field(doc, "Nationality", a.nationality);
  field(doc, "Course / programme applied for", a.programme);
  field(doc, "Programme level", LEVELS[String(a.programme_level)] || a.programme_level);
  field(doc, "Academic year", a.academic_year);
  field(doc, "Intake", a.intake);
  field(doc, "Study mode", a.study_mode);
  field(doc, "Residential address", a.address);
  field(doc, "District", a.district);
  field(doc, "City / town", a.city_town);
  field(doc, "Mobile number", a.phone);
  field(doc, "Email address", a.email);

  section(doc, "2. EDUCATIONAL HISTORY / BACKGROUND");
  if (education.length === 0) doc.text("No schools listed.");
  education.forEach((row, i) => {
    doc.font("Helvetica-Bold").text(`${i + 1}. ${val(row.school)}`);
    doc.font("Helvetica").text(`    Year graduated: ${val(row.yearGraduated)}   Highest grade: ${val(row.highestGrade)}   Qualification: ${val(row.qualification)}   Graduated: ${row.graduated ? "Yes" : "No"}`);
  });

  section(doc, "3. ENROLLMENT CATEGORY");
  doc.text(val(ENROLL[String(a.enrollment_category)] || a.enrollment_category));

  section(doc, "4. APPLICATION FEE / PAYMENT");
  if (verified) {
    field(doc, "Application fee", `NLe ${verified.amount}`);
    field(doc, "Payment method", verified.method === "orange_money" ? "Orange Money" : "Cash deposit");
    field(doc, "Receipt / transaction reference", verified.reference || "Receipt photo on file");
    field(doc, "Fee status", "Verified");
  } else {
    field(doc, "Fee status", list.length ? "Not yet verified" : "Not paid");
  }

  section(doc, "5. PARENT / GUARDIAN INFORMATION");
  field(doc, "Full name", guardian.name);
  field(doc, "Contact number", guardian.contact);
  field(doc, "Address", guardian.address);
  field(doc, "Relationship to applicant", guardian.relationship);

  section(doc, "6. APPLICANT DECLARATION");
  doc.text("I hereby declare that the information provided in this application form is true, complete and accurate to the best of my knowledge and belief. I understand that any false information may result in the rejection of my application or withdrawal of admission.", { align: "justify" });
  doc.moveDown(0.5);
  field(doc, "Declared confirmed", a.declaration_confirmed ? "Yes" : "No");
  field(doc, "Applicant's signature (typed name)", a.declaration_name);
  field(doc, "Date", a.declaration_date);

  doc.moveDown(1.5);
  doc.fillColor("#555555").font("Helvetica-Oblique").fontSize(9).text("Office use only: this section is completed by the admissions office.");
  doc.end();
}
