import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Response } from "express";
import { getSupabase } from "../db/supabaseClient.js";
import { authenticate, ApplicationRow } from "./applicationPaymentService.js";
import { ORANGE_MONEY_NUMBER } from "./applicationPaymentPolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREST_PATH = path.join(__dirname, "..", "..", "assets", "mtec-crest.png");
const NAVY = "#0D1B3D";

const LEVEL_LABELS: Record<string, string> = { certificate: "Certificate", diploma: "Diploma" };
const METHOD_LABELS: Record<string, string> = { orange_money: "Orange Money", cash: "Cash deposit" };

/** Streams the acceptance letter for an accepted applicant. The applicant must sign in with their
 *  application number and PIN, and the letter is only available once the application is accepted. */
export async function streamApplicantLetter(applicationNumber: string, pin: string, res: Response) {
  const app = await authenticate(applicationNumber, pin);
  return writeLetter(app, res);
}

/** The admin downloads an applicant's letter directly, without the applicant's PIN. */
export async function streamAdminLetter(applicationId: string, res: Response) {
  const { data, error } = await getSupabase().from("applications")
    .select("id, application_number, status, full_name, programme, programme_level, pin_id, rejection_reason")
    .eq("id", applicationId).maybeSingle();
  if (error) throw new Error(`streamAdminLetter failed: ${error.message}`);
  if (!data) throw new Error("That application was not found.");
  return writeLetter(data as unknown as ApplicationRow, res);
}

async function writeLetter(app: ApplicationRow, res: Response) {
  if (app.status !== "accepted" && app.status !== "approved") {
    throw new Error("Your letter is not ready. It is available once your application is accepted.");
  }
  const supabase = getSupabase();
  const { data: payment } = await supabase.from("application_payments")
    .select("amount, method, reference, reviewed_at")
    .eq("application_id", app.id).eq("status", "verified")
    .order("reviewed_at", { ascending: false }).limit(1).maybeSingle();
  const paid = payment as unknown as { amount: number; method: string; reference: string | null } | null;
  if (!paid) throw new Error("No verified fee payment was found for this application.");
  const { data: details } = await supabase.from("applications")
    .select("academic_year, intake, study_mode").eq("id", app.id).maybeSingle();
  const info = (details || {}) as unknown as { academic_year: string; intake: string; study_mode: string };
  const level = LEVEL_LABELS[app.programme_level || ""] || "";
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const doc = new PDFDocument({ size: "A4", margin: 56 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="MTeC-acceptance-${app.application_number}.pdf"`);
  doc.pipe(res);

  if (fs.existsSync(CREST_PATH)) doc.image(CREST_PATH, 56, 40, { width: 70 });
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(15).text("Makeni Technical College of Innovative Technology", 140, 52, { width: 380 });
  doc.fillColor("#555555").font("Helvetica").fontSize(9)
    .text("53 Station Road, opposite the Light Center, Makeni  |  +232 76 866 665  |  mtecsl.info@gmail.com", 140, 84, { width: 380 });
  doc.moveDown(4);

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(18).text("Letter of Acceptance");
  doc.moveDown(0.5);
  doc.fillColor("black").font("Helvetica").fontSize(11);
  doc.text(`Date: ${today}`);
  doc.text(`Application number: ${app.application_number}`);
  doc.moveDown();
  doc.text(`Dear ${app.full_name},`);
  doc.moveDown();
  doc.text(
    `We are pleased to inform you that your application to study ${app.programme}` +
    (level ? ` (${level})` : "") +
    ` at Makeni Technical College of Innovative Technology has been accepted` +
    (info.academic_year ? ` for the ${info.academic_year} academic year` : "") +
    (info.intake ? `, ${info.intake} intake` : "") +
    (info.study_mode ? `, ${info.study_mode} study mode` : "") + ".",
    { align: "justify" },
  );
  doc.moveDown();
  doc.text(`Application fee paid: NLe ${paid.amount} by ${METHOD_LABELS[paid.method] || paid.method}` +
    (paid.reference ? `, reference ${paid.reference}` : "") + ".");
  doc.moveDown();
  doc.text(
    "Next steps: keep this letter, your application number and your PIN. Follow the instructions from the " +
    "Admissions Office to complete enrolment and registration. Any question about fees can be sent to " +
    `${ORANGE_MONEY_NUMBER}.`,
    { align: "justify" },
  );
  // After approval the letter carries the student ID and PIN the applicant uses to register.
  const { data: link } = await supabase.from("applications").select("student_id").eq("id", app.id).maybeSingle();
  const studentId = (link as unknown as { student_id: string | null } | null)?.student_id;
  if (studentId) {
    const { data: student } = await supabase.from("students").select("student_id, student_pin").eq("student_id", studentId).maybeSingle();
    const login = student as unknown as { student_id: string; student_pin: string } | null;
    if (login) {
      doc.moveDown(1.5);
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text("Your student login");
      doc.fillColor("black").font("Helvetica").fontSize(11);
      doc.text(`Student ID: ${login.student_id}`);
      doc.text(`Registration PIN: ${login.student_pin}`);
      doc.text("Sign in to the Student Portal with your Student ID and PIN. On first sign-in you will be asked to set a new password.", { align: "justify" });
    }
  }
  doc.moveDown(3);
  doc.text("Admissions Office");
  doc.text("Makeni Technical College of Innovative Technology");
  doc.end();
}
