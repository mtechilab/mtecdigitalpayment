import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStudentUpdate, validateProgramme, validateFees, canDeleteStudent } from "../src/services/adminManagementPolicy.ts";

test("student changes are checked field by field", () => {
  assert.equal(validateStudentUpdate({ fullName: "Musa Bah Sesay" }), null);
  assert.notEqual(validateStudentUpdate({ fullName: "Mu" }), null);
  assert.notEqual(validateStudentUpdate({ phone: "123" }), null);
  assert.equal(validateStudentUpdate({ email: "" }), null);
  assert.notEqual(validateStudentUpdate({ email: "not-an-email" }), null);
  assert.equal(validateStudentUpdate({ status: "inactive" }), null);
  assert.notEqual(validateStudentUpdate({ status: "deleted" }), null);
});

test("a programme needs a name, and a sensible duration", () => {
  assert.equal(validateProgramme({ name: "Business Administration", durationYears: 2 }), null);
  assert.notEqual(validateProgramme({ name: "BA" }), null);
  assert.notEqual(validateProgramme({ name: "Business Administration", durationYears: 0 }), null);
  assert.notEqual(validateProgramme({ name: "Business Administration", durationYears: 11 }), null);
});

test("fees must be sensible amounts", () => {
  assert.equal(validateFees(0, 500), null);
  assert.notEqual(validateFees(-1, 500), null);
  assert.notEqual(validateFees(0, 0), null);
  assert.notEqual(validateFees(0, 1e9), null);
});

test("a student is deleted only when every related count is zero, and any unknown count refuses", () => {
  assert.equal(canDeleteStudent([0, 0, 0, 0]), true);
  assert.equal(canDeleteStudent([0, 1, 0, 0]), false);
  assert.equal(canDeleteStudent([0, null, 0, 0]), false);
  assert.equal(canDeleteStudent([]), false);
});
