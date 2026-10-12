import { test } from "node:test";
import assert from "node:assert/strict";
import { validateNewStaffAccount, validateStaffUpdate, canTeach, isAdministratorRole } from "../src/services/staffValidation.ts";

const base = { username: "ngoda.s", password: "a-long-password", fullName: "Ngoda Sesay" };

test("all three roles can be assigned", () => {
  for (const role of ["staff", "lecturer", "administrator"]) {
    assert.equal(validateNewStaffAccount({ ...base, role }), null, role);
  }
});

test("an unknown role is refused", () => {
  assert.notEqual(validateNewStaffAccount({ ...base, role: "superuser" }), null);
});

test("lecturers and administrators can teach; plain staff cannot", () => {
  assert.equal(canTeach("lecturer"), true);
  assert.equal(canTeach("administrator"), true);
  assert.equal(canTeach("staff"), false);
});

test("only the administrator role manages other people's material", () => {
  assert.equal(isAdministratorRole("administrator"), true);
  assert.equal(isAdministratorRole("lecturer"), false);
});

test("an update changes only what is given, and checks what it changes", () => {
  assert.equal(validateStaffUpdate({ role: "lecturer" }), null);
  assert.equal(validateStaffUpdate({ fullName: "  " }) !== null, true);
  assert.equal(validateStaffUpdate({ password: "short" }) !== null, true);
  assert.equal(validateStaffUpdate({ role: "admin" }) !== null, true);
});
