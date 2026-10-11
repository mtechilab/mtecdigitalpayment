import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import type { Response } from "express";
import { getSupabase } from "../db/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREST_PATH = path.join(__dirname, "..", "..", "assets", "mtec-crest.png");
const NAVY = "#0D1B3D";
const GOLD = "#D4A017";

interface ReceiptRow {
  receipt_number: string;
  student_name: string;
  student_id_number: string;
  programme: string;
  amount: number | string;
  method: string;
  date: string;
  received_by: string;
  previous_balance: number | string;
  new_balance: number | string;
}

const METHOD_LABELS: Record<string, string> = {
  monime: "Mobile Money (Monime)",
  orange_money: "Orange Money",
  orange_money_agent: "Orange Money (Agent)",
  cash: "Cash",
  cash_deposit: "Cash deposit",
  bank: "Bank transfer",
  alternative_account: "Bank transfer",
};

const money = (n: number) => `Le ${Math.round(n).toLocaleString("en-US")}`;

function formatDate(iso: string): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const d = new Date(iso);
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** Streams one receipt as a PDF. The receipt must belong to this student: the
 *  lookup filters on the student's row id, so another student's receipt number
 *  returns "not found" rather than the document. */
export async function streamReceiptPdf(studentRowId: string, receiptNumber: string, res: Response) {
  const { data, error } = await getSupabase()
    .from("receipts")
    .select("receipt_number, student_name, student_id_number, programme, amount, method, date, received_by, previous_balance, new_balance")
    .eq("receipt_number", receiptNumber)
    .eq("student_row_id", studentRowId)
    .maybeSingle();
  if (error) throw new Error(`streamReceiptPdf failed: ${error.message}`);
  if (!data) throw new Error("Receipt not found.");

  const r = data as unknown as ReceiptRow;
  const amount = Number(r.amount);
  const before = Number(r.previous_balance);
  const after = Number(r.new_balance);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${r.receipt_number}.pdf"`);
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - 100;

  try {
    doc.image(CREST_PATH, 50, 40, { width: 60 });
  } catch {
    // A missing crest shouldn't stop the receipt from being issued.
  }
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(18).text("MTeC", 125, 44);
  doc.fillColor("black").font("Helvetica").fontSize(10).text("Makeni Technical College of Innovative Technology", 125, 68);
  doc.fillColor(GOLD).font("Helvetica-Oblique").fontSize(9).text("Skills for Innovation", 125, 82);
  doc.moveTo(50, 115).lineTo(pageWidth - 50, 115).strokeColor(GOLD).lineWidth(2).stroke();
  doc.strokeColor("black").lineWidth(1);

  doc.rect(50, 130, contentWidth, 26).fill(NAVY);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(13)
    .text("PAYMENT RECEIPT", 50, 139, { align: "center", width: contentWidth });
  doc.fillColor("black");

  let y = 175;
  const row = (label: string, value: string) => {
    doc.font("Helvetica-Bold").fontSize(10).text(label, 50, y, { width: 170 });
    doc.font("Helvetica").text(value, 220, y, { width: contentWidth - 170 });
    y += 20;
  };
  row("Receipt number", r.receipt_number);
  row("Date", formatDate(r.date));
  row("Student name", r.student_name);
  row("Student ID", r.student_id_number);
  row("Programme", r.programme);
  row("Payment method", METHOD_LABELS[r.method] || r.method);
  row("Received by", r.received_by);

  y += 12;
  doc.rect(50, y, contentWidth, 22).fill("#EAF1FB");
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("Amount summary", 58, y + 6);
  doc.fillColor("black");
  y += 30;
  row("Balance before this payment", money(before));
  row("Amount received", money(amount));
  row("Balance after this payment", money(after));

  doc.font("Helvetica-Oblique").fontSize(8).fillColor("black")
    .text("This is an official payment receipt from MTeC. Keep it for your records.", 50, doc.page.height - 80, {
      align: "center",
      width: contentWidth,
    });

  doc.end();
}
