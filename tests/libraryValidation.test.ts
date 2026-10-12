import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLibraryUpload, sanitizeFileName, decodedBytes, MAX_LIBRARY_BYTES } from "../src/services/libraryValidation.ts";

const ok = { title: "Database design notes", programme: "Diploma in Computer Science", academicYear: "2026/2027",
  fileName: "notes.pdf", contentType: "application/pdf", fileBase64: "aGVsbG8gd29ybGQ=" };

test("a valid PDF is accepted and classified", () => {
  const r = validateLibraryUpload(ok);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.materialType, "pdf");
});

test("PowerPoint, Word and images are classified", () => {
  const pptx = validateLibraryUpload({ ...ok, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  const docx = validateLibraryUpload({ ...ok, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const jpg = validateLibraryUpload({ ...ok, contentType: "image/jpeg" });
  assert.equal(pptx.ok && pptx.materialType, "pptx");
  assert.equal(docx.ok && docx.materialType, "docx");
  assert.equal(jpg.ok && jpg.materialType, "image");
});

test("video and unknown types are refused", () => {
  assert.equal(validateLibraryUpload({ ...ok, contentType: "video/mp4" }).ok, false);
  assert.equal(validateLibraryUpload({ ...ok, contentType: "application/x-msdownload" }).ok, false);
});

test("files over 5 MB are refused", () => {
  const big = "A".repeat(Math.ceil((MAX_LIBRARY_BYTES + 10) * 4 / 3));
  assert.equal(validateLibraryUpload({ ...ok, fileBase64: big }).ok, false);
});

test("an empty or malformed file is refused", () => {
  assert.equal(validateLibraryUpload({ ...ok, fileBase64: "" }).ok, false);
  assert.equal(validateLibraryUpload({ ...ok, fileBase64: "not base64!" }).ok, false);
});

test("the academic year must look like 2026 or 2026/2027", () => {
  assert.equal(validateLibraryUpload({ ...ok, academicYear: "next year" }).ok, false);
  assert.equal(validateLibraryUpload({ ...ok, academicYear: "2026/2027" }).ok, true);
});

test("a short or missing title is refused", () => {
  assert.equal(validateLibraryUpload({ ...ok, title: "ab" }).ok, false);
});

test("file names cannot carry folders or unusual characters", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFileName("my notes (final).pdf"), "my notes _final_.pdf");
  assert.equal(sanitizeFileName(""), "file");
});

test("decoded size matches the original bytes", () => {
  assert.equal(decodedBytes("aGVsbG8gd29ybGQ="), 11);
});
