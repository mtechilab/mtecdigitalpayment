import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCheckin, saveOutcome, DEFAULT_MILESTONES } from "../src/services/checkinPolicy.ts";

const full = { workCompleted: "Built the login page", skillsLearned: "Form validation", challenges: "Slow internet", nextPlan: "Connect the database" };

test("a draft may be incomplete, but a submission needs all four answers", () => {
  assert.equal(validateCheckin({ workCompleted: "Built" }, false), null);
  assert.notEqual(validateCheckin({ workCompleted: "Built" }, true), null);
  assert.equal(validateCheckin(full, true), null);
  assert.notEqual(validateCheckin({ ...full, challenges: "  ok " }, true), null);
});

test("answers must be text and not too long", () => {
  assert.notEqual(validateCheckin({ ...full, nextPlan: 42 }, false), null);
  assert.notEqual(validateCheckin({ ...full, nextPlan: "x".repeat(501) }, true), null);
});

test("a submitted check-in is never overwritten; the same request twice is one save", () => {
  assert.equal(saveOutcome(null, "draft", false), "create");
  assert.equal(saveOutcome("draft", "draft", false), "update");
  assert.equal(saveOutcome("submitted", "draft", false), "refuse");
  assert.equal(saveOutcome("submitted", "submitted", true), "already_saved");
  assert.equal(DEFAULT_MILESTONES.length, 6);
});
