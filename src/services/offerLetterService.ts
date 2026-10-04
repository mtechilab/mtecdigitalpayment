import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import { getSupabase } from "../db/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREST_PATH = path.join(__dirname, "..", "..", "assets", "mtec-crest.png");

const NAVY = "#0D1B3D";
const GOLD = "#D4A017";
const LIGHT_BLUE = "#EAF1FB";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  monime: "Monime",
  orange_money: "Orange Money",
  orange_money_agent: "Orange Money (Agent)",
  cash_deposit: "Cash Deposit",
  alternative_account: "Bank Transfer",
};

/** The qualification level isn't its own column anywhere — it's embedded
 *  in the programme name ("Diploma in...", "Higher Diploma in..."). This
 *  pulls it out rather than inventing a field the schema doesn't have.
 *  Falls back to "—" for a programme name that doesn't start with a
 *  recognised qualification word, rather than guessing. */
function extractLevel(programmeName: string): string {
  const known = ["Higher National Diploma", "Higher Diploma", "Advanced Diploma", "Diploma", "Certificate", "Degree"];
  for (const level of known) {
    if (programmeName.toLowerCase().startsWith(level.toLowerCase())) return level;
  }
  return "—";
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatDate(d: Date): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${ordinal(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** Streams a PDF acceptance letter straight to the response, same
 *  no-temp-file approach as streamResultSlip. Built from real student /
 *  application / fee-structure / payment data — NOT from the offer_letters
 *  table, which nothing in this codebase ever actually inserts into (it's
 *  read in a couple of places but never written), so depending on it would
 *  make this letter empty for every real student. If an offer_letters row
 *  does happen to exist for this application, its admission_conditions and
 *  authorized_signatory are used to enrich the letter; otherwise sensible
 *  defaults are used and the letter still works. */
export async function streamAcceptanceLetter(studentRowId: string, res: import("express").Response) {
  const supabase = getSupabase();

  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("full_name, student_id, programme, academic_year, application_id, created_at")
    .eq("id", studentRowId)
    .maybeSingle();
  if (studentError) throw new Error(`streamAcceptanceLetter (student) failed: ${studentError.message}`);
  if (!student) throw new Error("Student not found.");

  const { data: application } = await supabase
    .from("applications")
    .select("application_number, intake, study_mode")
    .eq("id", student.application_id)
    .maybeSingle();

  // Optional enrichment — see function comment above.
  const { data: offerLetter } = await supabase
    .from("offer_letters")
    .select("admission_conditions, authorized_signatory, acceptance_deadline")
    .eq("application_id", student.application_id)
    .maybeSingle();

  const { data: programme } = await supabase
    .from("programmes").select("duration_years, duration_label").ilike("name", student.programme).maybeSingle();

  const { data: fees } = await supabase
    .from("fee_structures").select("registration_fee, tuition_per_semester").eq("programme", student.programme).maybeSingle();

  const { data: plan } = await supabase
    .from("payment_plans")
    .select("id, total_amount")
    .eq("student_row_id", studentRowId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let amountPaid = 0;
  if (plan) {
    const { data: periods } = await supabase.from("payment_periods").select("amount_paid").eq("payment_plan_id", plan.id);
    amountPaid = (periods || []).reduce((sum, p) => sum + Number(p.amount_paid), 0);
  }

  const { data: lastPayment } = await supabase
    .from("payment_submissions")
    .select("method, provider_reference, mtec_reference")
    .eq("student_row_id", studentRowId)
    .eq("status", "verified")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ---- Derived values ----
  const level = extractLevel(student.programme);
  const durationLabel = programme?.duration_label
    || (programme ? `${programme.duration_years} Years (${Math.round(Number(programme.duration_years) * 2)} Semesters)` : "—");
  const registrationFee = fees ? Number(fees.registration_fee) : null;
  const tuitionFee = fees ? Number(fees.tuition_per_semester) : null;
  const totalFee = plan ? Number(plan.total_amount) : (registrationFee !== null && tuitionFee !== null ? registrationFee + tuitionFee : null);
  const outstandingBalance = totalFee !== null ? totalFee - amountPaid : null;
  const paymentMethodLabel = lastPayment ? (PAYMENT_METHOD_LABELS[lastPayment.method] || lastPayment.method) : null;
  const paymentReference = lastPayment ? (lastPayment.provider_reference || lastPayment.mtec_reference) : null;
  const dateOfIssue = formatDate(new Date(student.created_at));
  const refNumber = application?.application_number ? `MTeC/ADM/${student.academic_year}/${application.application_number}` : `MTeC/ADM/${student.academic_year}/${student.student_id}`;

  const money = (n: number) => `Le ${n.toLocaleString("en-US")}`;

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${student.student_id}-acceptance-letter.pdf"`);
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - 80;

  // ---- Header ----
  try {
    doc.image(CREST_PATH, 40, 36, { width: 64 });
  } catch {
    // Missing/unreadable asset shouldn't take the whole letter down.
  }
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(22).text("MTeC", 115, 38, { align: "center", width: contentWidth - 150 });
  doc.fontSize(13).text("MAKENI TECHNICAL COLLEGE OF", 115, 64, { align: "center", width: contentWidth - 150 });
  doc.text("INNOVATIVE TECHNOLOGY", 115, 80, { align: "center", width: contentWidth - 150 });
  doc.font("Helvetica-Oblique").fontSize(10).fillColor(GOLD).text("Skills for Innovation", 115, 98, { align: "center", width: contentWidth - 150 });
  doc.fillColor("black").font("Helvetica").fontSize(8)
    .text("53 Station Road, Makeni, Sierra Leone   |   mtecsl.info@gmail.com   |   +232 76 866 665", 40, 120, { align: "center", width: contentWidth });

  doc.moveTo(40, 140).lineTo(pageWidth - 40, 140).strokeColor(GOLD).lineWidth(2).stroke();
  doc.strokeColor("black").lineWidth(1);

  // ---- Banner ----
  doc.rect(40, 150, contentWidth, 28).fill(NAVY);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(14).text("STUDENT ACCEPTANCE LETTER", 40, 158, { align: "center", width: contentWidth });
  doc.fillColor("black").font("Helvetica").fontSize(10).text(`ACADEMIC YEAR: ${student.academic_year}`, 40, 184, { align: "center", width: contentWidth });

  // ---- Admission No. / Date of Issue / Ref ----
  let y = 206;
  doc.font("Helvetica-Bold").fontSize(9).text("Admission No.:", 40, y);
  doc.font("Helvetica").text(student.student_id, 150, y);
  doc.font("Helvetica-Bold").text(`Ref: ${refNumber}`, 40, y, { align: "right", width: contentWidth });
  y += 16;
  doc.font("Helvetica-Bold").text("Date of Issue:", 40, y);
  doc.font("Helvetica").text(dateOfIssue, 150, y);
  y += 26;

  // ---- Salutation ----
  doc.font("Helvetica").fontSize(10).text(`Dear ${student.full_name},`, 40, y);
  y = doc.y + 8;
  doc.font("Helvetica-Bold").text("RE: OFFER OF ADMISSION", 40, y);
  y = doc.y + 6;
  doc.font("Helvetica").text(
    `We are pleased to inform you that MTeC — Makeni Technical College of Innovative Technology has offered you admission for the ${student.academic_year} Academic Year. Your admission details are as follows:`,
    40, y, { width: contentWidth });
  y = doc.y + 10;

  // ---- Admission details table ----
  const detailRows: [string, string][] = [
    ["Student Full Name", student.full_name],
    ["Student ID", student.student_id],
    ["Programme", student.programme],
    ["Level", level],
    ["Duration", durationLabel],
    ["Semester/Intake", application?.intake || "—"],
  ];
  const labelWidth = 160;
  for (const [label, value] of detailRows) {
    doc.rect(40, y, labelWidth, 20).fillAndStroke(LIGHT_BLUE, "black");
    doc.rect(40 + labelWidth, y, contentWidth - labelWidth, 20).stroke();
    doc.fillColor("black").font("Helvetica-Bold").fontSize(9).text(label, 46, y + 6, { width: labelWidth - 10 });
    doc.font("Helvetica").text(value, 40 + labelWidth + 6, y + 6, { width: contentWidth - labelWidth - 12 });
    y += 20;
  }
  y += 10;

  doc.font("Helvetica").fontSize(9).text(
    "Your admission is subject to the successful completion of registration and submission/verification of the required documents." +
    (offerLetter?.admission_conditions ? ` ${offerLetter.admission_conditions}` : ""),
    40, y, { width: contentWidth });
  y = doc.y + 12;

  // ---- Two columns: Registration Requirements | Fees & Payment ----
  const colWidth = (contentWidth - 16) / 2;
  const leftX = 40;
  const rightX = 40 + colWidth + 16;
  const sectionTop = y;

  doc.rect(leftX, sectionTop, colWidth, 16).fill(LIGHT_BLUE);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text("REGISTRATION REQUIREMENTS", leftX + 4, sectionTop + 4);
  doc.rect(rightX, sectionTop, colWidth, 16).fill(LIGHT_BLUE);
  doc.text("FEES & PAYMENT INFORMATION", rightX + 4, sectionTop + 4);
  doc.fillColor("black");

  const requirements = [
    "Completed admission/application form",
    "Copy of relevant academic certificate/result or supporting document",
    "Copy of National Identification/valid ID",
    "Passport-size photographs",
    "Payment of the applicable registration/tuition fees",
    "Any other documents required by the College",
  ];
  let leftY = sectionTop + 22;
  doc.font("Helvetica").fontSize(8);
  requirements.forEach((req, i) => {
    doc.text(`${i + 1}. ${req}`, leftX, leftY, { width: colWidth });
    leftY = doc.y + 4;
  });

  const feeRows: [string, string][] = [
    ["Application/Registration Fee", registrationFee !== null ? money(registrationFee) : "—"],
    ["Tuition/Programme Fee", tuitionFee !== null ? money(tuitionFee) : "—"],
    ["Amount Paid", totalFee !== null ? money(amountPaid) : "—"],
    ["Outstanding Balance", outstandingBalance !== null ? money(outstandingBalance) : "—"],
    ["Payment Method", paymentMethodLabel || "Not yet paid"],
    ["Reference/Transaction No.", paymentReference || "—"],
  ];
  let rightY = sectionTop + 22;
  doc.font("Helvetica").fontSize(8);
  feeRows.forEach(([label, value]) => {
    doc.font("Helvetica-Bold").text(`${label}:`, rightX, rightY, { width: colWidth });
    doc.font("Helvetica").text(value, rightX, doc.y, { width: colWidth });
    rightY = doc.y + 5;
  });

  y = Math.max(leftY, rightY) + 10;

  // ---- Student declaration ----
  doc.rect(40, y, contentWidth, 14).fill(LIGHT_BLUE);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text("STUDENT DECLARATION", 44, y + 3);
  doc.fillColor("black");
  y += 20;
  doc.font("Helvetica").fontSize(8).text(
    `I, ${student.full_name}, confirm that I have received this admission offer and agree to abide by the rules, regulations, ` +
    `academic requirements, attendance requirements, and code of conduct of MTeC. I understand that admission may be subject to ` +
    `verification of the information and documents submitted during the application process.`,
    40, y, { width: contentWidth });
  y = doc.y + 10;
  doc.text("Student Signature: ________________________________          Date: ________________________", 40, y);
  y = doc.y + 16;

  // ---- For official use ----
  doc.rect(40, y, contentWidth, 14).fill(LIGHT_BLUE);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text("FOR OFFICIAL USE", 44, y + 3);
  doc.fillColor("black");
  y += 20;
  doc.font("Helvetica").fontSize(8);
  doc.text("Admission/Registrar's Signature: ________________________________", 40, y);
  y = doc.y + 6;
  doc.text(`Principal/Director: ${offerLetter?.authorized_signatory || "________________________________"}`, 40, y);
  doc.text("Official College Stamp:", 40, doc.y + 6);
  doc.circle(pageWidth - 90, y + 20, 26).dash(2, { space: 2 }).stroke();
  doc.undash();
  y = doc.y + 30;

  doc.font("Helvetica-Oblique").fontSize(8).fillColor(NAVY)
    .text("We congratulate you on your admission and welcome you to MTeC — Makeni Technical College of Innovative Technology.", 40, y, { width: contentWidth });
  doc.fillColor("black");

  // ---- Detachable slip ----
  const slipY = doc.page.height - 150;
  doc.moveTo(40, slipY).lineTo(pageWidth - 40, slipY).dash(3, { space: 3 }).strokeColor("black").stroke();
  doc.undash();
  doc.font("Helvetica").fontSize(7).fillColor(NAVY)
    .text("✂  DETACHABLE STUDENT ACCEPTANCE SLIP — please return this slip to the College during registration", 40, slipY + 4, { align: "center", width: contentWidth });
  doc.fillColor("black");

  let sy = slipY + 20;
  const slipLeft: [string, string][] = [
    ["Admission No.", student.student_id],
    ["Student Name", student.full_name],
    ["Programme", student.programme],
    ["Level", level],
  ];
  const slipRight: [string, string][] = [
    ["Amount Paid", totalFee !== null ? money(amountPaid) : "—"],
    ["Outstanding Balance", outstandingBalance !== null ? money(outstandingBalance) : "—"],
    ["Student Signature", "________________"],
    ["Date", dateOfIssue],
  ];
  doc.fontSize(8);
  for (let i = 0; i < slipLeft.length; i++) {
    doc.font("Helvetica-Bold").text(`${slipLeft[i][0]}: `, 40, sy, { continued: true }).font("Helvetica").text(slipLeft[i][1]);
    doc.font("Helvetica-Bold").text(`${slipRight[i][0]}: `, 320, sy, { continued: true }).font("Helvetica").text(slipRight[i][1]);
    sy += 16;
  }

  // ---- Footer ----
  doc.rect(0, doc.page.height - 26, pageWidth, 26).fill(NAVY);
  doc.fillColor("white").font("Helvetica-Oblique").fontSize(9)
    .text("Skills for Innovation", 0, doc.page.height - 19, { align: "center", width: pageWidth });

  doc.end();
}
