import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEnrollmentCategory, validateDateOfBirth, validateGuardian, validateEducation, cleanEducation, validateDeclaration } from "../src/services/applicationFormPolicy.ts";

test("enrollment is self-funded or sponsored", () => {
  assert.equal(validateEnrollmentCategory("self_funded"), null);
  assert.equal(validateEnrollmentCategory("sponsored"), null);
  assert.notEqual(validateEnrollmentCategory("government"), null);
});

test("date of birth is DD/MM/YYYY or YYYY-MM-DD", () => {
  assert.equal(validateDateOfBirth("15/03/2005"), null);
  assert.equal(validateDateOfBirth("2005-03-15"), null);
  assert.notEqual(validateDateOfBirth("15-03-05"), null);
});

test("the guardian needs a name, contact, address, and relationship", () => {
  const ok = { name: "Mariama Kamara", contact: "+23276000000", address: "Makeni", relationship: "Mother" };
  assert.equal(validateGuardian(ok), null);
  assert.notEqual(validateGuardian({ ...ok, name: "Ma" }), null);
  assert.notEqual(validateGuardian({ ...ok, relationship: "" }), null);
});

test("an education row with a school needs its year, grade and qualification", () => {
  assert.equal(validateEducation([{ school: "", yearGraduated: "", highestGrade: "", qualification: "" }]), null);
  assert.notEqual(validateEducation([{ school: "Makeni Secondary", yearGraduated: "2022", highestGrade: "", qualification: "WASSCE" }]), null);
  assert.equal(validateEducation([{ school: "Makeni Secondary", yearGraduated: "2022", highestGrade: "A", qualification: "WASSCE", graduated: true }]), null);
  assert.notEqual(validateEducation(new Array(6).fill({ school: "x", yearGraduated: "1", highestGrade: "1", qualification: "1" })), null);
});

test("empty education rows are dropped when saved", () => {
  const rows = cleanEducation([{ school: "", yearGraduated: "", highestGrade: "", qualification: "" }, { school: " Bo School ", yearGraduated: "2020", highestGrade: "B", qualification: "WASSCE", graduated: true }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].school, "Bo School");
});

test("the declaration needs confirmation, a typed signature, and a date", () => {
  assert.equal(validateDeclaration(true, "Musa Bah Sesay", "17/10/2026"), null);
  assert.notEqual(validateDeclaration(false, "Musa Bah Sesay", "17/10/2026"), null);
  assert.notEqual(validateDeclaration(true, "Mu", "17/10/2026"), null);
  assert.notEqual(validateDeclaration(true, "Musa Bah Sesay", ""), null);
});
