import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Response } from "express";
import { getSupabase } from "../db/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREST_PATH = path.join(__dirname, "..", "..", "assets", "mtec-crest.png");
const NAVY = "#0B2A5B";
const BLUE = "#1E4FA3";
const GOLD = "#F2B705";
const LIGHT = "#EEF4FB";
const MUTED = "#4A5A78";
const CONTACT = "+232 76 866 665";
const EMAIL = "mtecsl.info@gmail.com";
const ADDRESS = "53 Station Road, opposite the Light Center, Makeni";

const METHOD_LABELS: Record<string, string> = {
  monime: "Mobile Money", orange_money: "Orange Money", orange_money_agent: "Orange Money (Agent)",
  cash: "Cash", cash_deposit: "Cash", bank: "Bank transfer", alternative_account: "Bank transfer",
};

/** Money with two decimals, as on the official receipt: NLe 500.00 */
export function money(n: number): string {
  return `NLe ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

/** Streams one official receipt as a PDF. It only opens receipts that belong to this student. */
export async function streamReceiptPdf(studentRowId: string, receiptNumber: string, res: Response) {
  const supabase = getSupabase();
  const { data: receipt, error } = await supabase.from("receipts")
    .select("receipt_number, student_row_id, amount, method, date, received_by, previous_balance, new_balance")
    .eq("receipt_number", receiptNumber).eq("student_row_id", studentRowId).maybeSingle();
  if (error) throw new Error(`Could not read the receipt: ${error.message}`);
  if (!receipt) throw new Error("Receipt not found.");
  const r = receipt as unknown as {
    receipt_number: string; amount: number | string; method: string; date: string; received_by: string | null;
    previous_balance: number | string | null; new_balance: number | string | null;
  };

  const { data: student, error: studentError } = await supabase.from("students")
    .select("student_id, full_name, programme, phone").eq("id", studentRowId).maybeSingle();
  if (studentError) throw new Error(`Could not read the student: ${studentError.message}`);
  const s = (student || {}) as unknown as { student_id?: string; full_name?: string; programme?: string; phone?: string };

  const amount = Number(r.amount) || 0;
  const before = Number(r.previous_balance) || 0;
  const after = Number(r.new_balance) || 0;
  const methodLabel = METHOD_LABELS[r.method] || r.method;

  const doc = new PDFDocument({ size: "A4", margin: 0 });
  // The PDF is built completely in memory and only then sent, so a failure returns a clear error
  // instead of a cut-off file that the phone reports as a lost connection.
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const fileName = r.receipt_number.replace(/\//g, "-");
  const W = doc.page.width;
  const M = 40;
  const CW = W - M * 2;

  // Header band
  doc.rect(0, 0, W, 130).fill(NAVY);
  doc.rect(0, 130, W, 4).fill(GOLD);
  if (fs.existsSync(CREST_PATH)) doc.image(CREST_PATH, M, 22, { width: 84 });
  doc.fillColor("white").font("Helvetica-Bold").fontSize(14).text("MAKENI TECHNICAL COLLEGE", 150, 28, { width: W - 190 });
  doc.font("Helvetica-Bold").fontSize(12).text("OF INNOVATION & TECHNOLOGY", 150, 46, { width: W - 190 });
  doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(30).text("MTeC", 150, 62);
  doc.fillColor("white").font("Helvetica-Oblique").fontSize(11).text("Skills for Innovation", 150, 100);

  // Title and receipt number
  doc.fillColor(BLUE).rect(M, 160, 330, 40).fill();
  doc.fillColor("white").font("Helvetica-Bold").fontSize(18).text("OFFICIAL RECEIPT", M + 16, 172);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("Receipt No.", W - M - 220, 166, { width: 120, align: "right" });
  doc.font("Helvetica-Bold").fontSize(13).text(r.receipt_number, W - M - 220, 180, { width: 220, align: "right" });

  // Details
  let y = 218;
  const rows: [string, string][] = [
    ["Student Name", s.full_name || "-"],
    ["Student ID", s.student_id || "-"],
    ["Phone", s.phone || "-"],
    ["Programme", s.programme || "-"],
    ["Type", "Fees payment"],
    ["Method", methodLabel],
    ["Date", formatDateTime(r.date)],
    ["Recorded by", r.received_by || "-"],
  ];
  rows.forEach(([label, value], i) => {
    doc.rect(M, y, CW, 30).fill(i % 2 === 0 ? LIGHT : "#FFFFFF");
    doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(label, M + 14, y + 10, { width: 150 });
    doc.fillColor("black").font("Helvetica-Bold").fontSize(11).text(value, M + 180, y + 9, { width: CW - 190 });
    y += 30;
  });

  // Amount paid
  y += 18;
  doc.rect(M, y, CW, 48).fill(NAVY);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(16).text("AMOUNT PAID", M + 14, y + 16);
  doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(20).text(money(amount), M, y + 13, { width: CW - 14, align: "right" });
  y += 64;

  // Balances
  doc.rect(M, y, CW, 84).fill(LIGHT);
  doc.fillColor(MUTED).font("Helvetica").fontSize(11).text("Balance before this payment", M + 14, y + 14);
  doc.fillColor("black").font("Helvetica-Bold").fontSize(11).text(money(before), M, y + 14, { width: CW - 14, align: "right" });
  doc.fillColor(MUTED).font("Helvetica").fontSize(11).text("Amount paid", M + 14, y + 34);
  doc.fillColor("black").font("Helvetica-Bold").fontSize(11).text(money(amount), M, y + 34, { width: CW - 14, align: "right" });
  doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(13).text("Balance due", M + 14, y + 56);
  doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(13).text(money(after), M, y + 56, { width: CW - 14, align: "right" });
  y += 110;

  // Signature
  doc.strokeColor(NAVY).lineWidth(1).moveTo(M, y + 40).lineTo(M + 240, y + 40).stroke();
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("Staff signature", M, y + 46);
  doc.fillColor("black").font("Helvetica").fontSize(10).text(r.received_by || "", M, y + 60, { width: 240 });
  doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(10).text("Thank you for your payment.", W - M - 240, y + 46, { width: 240, align: "right" });

  // Footer
  const footerY = doc.page.height - 86;
  doc.rect(0, footerY, W, 86).fill(NAVY);
  doc.fillColor("white").font("Helvetica").fontSize(9).text(`${CONTACT}   |   ${EMAIL}`, M, footerY + 22, { width: CW, align: "center" });
  doc.text(ADDRESS, M, footerY + 40, { width: CW, align: "center" });
  doc.fillColor(GOLD).font("Helvetica-Oblique").fontSize(9).text("This is an official receipt from MTeC. Keep it for your records.", M, footerY + 60, { width: CW, align: "center" });

  doc.end();
  const pdf = await finished;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${fileName}.pdf"`);
  res.setHeader("Content-Length", String(pdf.length));
  res.end(pdf);
}
