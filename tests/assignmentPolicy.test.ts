import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAssignment, validateSubmission, validateGrade, isOpen } from "../src/services/assignmentPolicy.ts";

const now = new Date("2026-10-01T09:00:00Z");
const good = { title: "Network report", instructions: "Explain the difference between a hub and a switch.", programme: "Diploma in Computer Science", dueAt: "2026-10-20T17:00:00Z" };

test("a valid assignment with a future due date is accepted", () => {
  assert.equal(validateAssignment(good, now), null);
});

test("a due date in the past is refused", () => {
  assert.notEqual(validateAssignment({ ...good, dueAt: "2026-09-01T00:00:00Z" }, now), null);
});

test("instructions must be a real description", () => {
  assert.notEqual(validateAssignment({ ...good, instructions: "short" }, now), null);
});

test("an empty or oversized submission is refused", () => {
  assert.notEqual(validateSubmission("   "), null);
  assert.notEqual(validateSubmission("x".repeat(5001)), null);
  assert.equal(validateSubmission("My answer"), null);
});

test("submissions are open only before the due date", () => {
  assert.equal(isOpen("2026-10-20T17:00:00Z", now), true);
  assert.equal(isOpen("2026-10-01T08:00:00Z", now), false);
});

test("a grade is a whole number from 0 to 100 with bounded feedback", () => {
  assert.equal(validateGrade(72, "Good structure"), null);
  assert.notEqual(validateGrade(101, ""), null);
  assert.notEqual(validateGrade(72.5, ""), null);
  assert.notEqual(validateGrade(50, "x".repeat(2001)), null);
});
