import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePost, validateImage, isVisible } from "../src/services/newsPolicy.ts";

test("a post needs a kind, a title, a message, and an audience", () => {
  const ok = { kind: "notice", title: "Exams start Monday", body: "Bring your student ID.", audience: "all", expiresAt: null };
  assert.equal(validatePost(ok), null);
  assert.notEqual(validatePost({ ...ok, kind: "gossip" }), null);
  assert.notEqual(validatePost({ ...ok, title: "Hi" }), null);
  assert.notEqual(validatePost({ ...ok, body: "" }), null);
  assert.notEqual(validatePost({ ...ok, audience: "" }), null);
});

test("an expiry date must be in the future", () => {
  const base = { kind: "news", title: "New lab opens", body: "The new lab opens this week.", audience: "all" };
  assert.equal(validatePost({ ...base, expiresAt: "2099-01-01T00:00:00Z" }), null);
  assert.notEqual(validatePost({ ...base, expiresAt: "2001-01-01T00:00:00Z" }), null);
});

test("images must be JPG, PNG or WEBP and up to 5 MB", () => {
  assert.equal(validateImage("image/png", "aGVsbG8="), null);
  assert.notEqual(validateImage("application/pdf", "aGVsbG8="), null);
  assert.notEqual(validateImage("image/png", "not base64!"), null);
});

test("a post shows to everyone or to its programme, until it expires", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  assert.equal(isVisible("all", null, "Diploma in Computer Science", now), true);
  assert.equal(isVisible("Diploma in Computer Science", null, "Diploma in Computer Science", now), true);
  assert.equal(isVisible("Make up Artistry", null, "Diploma in Computer Science", now), false);
  assert.equal(isVisible("all", "2026-10-19T00:00:00Z", "Diploma in Computer Science", now), false);
});
