import PDFDocument from "pdfkit";
import type { Response } from "express";

export interface ExportableDraft {
  title: string;
  kind: string;
  programme: string;
  course_code: string;
  version: number;
  content: string;
  status: string;
}

const KIND_LABELS: Record<string, string> = {
  course_outline: "Course outline", syllabus: "Syllabus", lesson_plan: "Lesson plan",
  lecture_notes: "Lecture notes", assignment: "Assignment", quiz: "Quiz with answers", revision_notes: "Revision notes",
};

/** Streams a draft as a PDF download. The text is what the lecturer saved, so the file matches the screen. */
export function streamDraftPdf(draft: ExportableDraft, res: Response) {
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  const safeName = draft.title.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 60) || "draft";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}-v${draft.version}.pdf"`);
  doc.pipe(res);

  const course = draft.course_code ? ` \u00b7 ${draft.course_code}` : "";
  const state = draft.status === "approved" ? "Approved" : "Draft for review";
  doc.fillColor("#0D1B3D").font("Helvetica-Bold").fontSize(16).text(draft.title);
  doc.fillColor("#555555").font("Helvetica").fontSize(9)
    .text(`${KIND_LABELS[draft.kind] || "Material"} \u00b7 ${draft.programme}${course} \u00b7 version ${draft.version} \u00b7 ${state}`);
  doc.moveDown();
  doc.fillColor("black").font("Helvetica").fontSize(11).text(draft.content, { align: "left" });
  doc.moveDown(2);
  doc.fillColor("#777777").font("Helvetica-Oblique").fontSize(8)
    .text("AI-generated draft from MTeC Digital Campus. Check every fact before use.");
  doc.end();
}
