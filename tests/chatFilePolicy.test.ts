import { test } from "node:test";
import assert from "node:assert/strict";
import { validateChatFile, sanitizeFileName } from "../src/services/chatFilePolicy.ts";

const small = "aGVsbG8=";
const sizeOf = (bytes: number) => "A".repeat(Math.ceil((bytes * 4) / 3));

test("a photo and a PDF are accepted and classified", () => {
  const photo = validateChatFile("image/jpeg", "me.jpg", small);
  const pdf = validateChatFile("application/pdf", "notes.pdf", small);
  assert.equal(photo.ok && photo.kind, "image");
  assert.equal(pdf.ok && pdf.kind, "file");
});

test("Word and PowerPoint are accepted", () => {
  assert.equal(validateChatFile("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx", small).ok, true);
  assert.equal(validateChatFile("application/vnd.openxmlformats-officedocument.presentationml.presentation", "a.pptx", small).ok, true);
});

test("other types are refused", () => {
  assert.equal(validateChatFile("application/x-msdownload", "run.exe", small).ok, false);
  assert.equal(validateChatFile("video/mp4", "clip.mp4", small).ok, false);
});

test("photos are limited to 5 MB and documents to 10 MB", () => {
  assert.equal(validateChatFile("image/png", "p.png", sizeOf(6 * 1024 * 1024)).ok, false);
  assert.equal(validateChatFile("application/pdf", "d.pdf", sizeOf(6 * 1024 * 1024)).ok, true);
  assert.equal(validateChatFile("application/pdf", "d.pdf", sizeOf(11 * 1024 * 1024)).ok, false);
});

test("file names cannot carry folders or unusual characters", () => {
  assert.equal(sanitizeFileName("../../secret.pdf"), "secret.pdf");
  assert.equal(sanitizeFileName(""), "file");
});
