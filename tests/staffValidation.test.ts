import { test } from "node:test";
import assert from "node:assert/strict";
import { validateNewStaffAccount, normaliseUsername } from "../src/services/staffValidation.ts";

const good = { username: "amina.kamara", password: "a-long-password", fullName: "Amina Kamara", role: "lecturer" };

test("a complete account is accepted", () => {
  assert.equal(validateNewStaffAccount(good), null);
});

test("usernames are normalised to lower case", () => {
  assert.equal(normaliseUsername("  Amina.Kamara "), "amina.kamara");
});

test("a short password is refused", () => {
  assert.match(validateNewStaffAccount({ ...good, password: "short" }) ?? "", /at least 8/);
});

test("a username with spaces or symbols is refused", () => {
  assert.notEqual(validateNewStaffAccount({ ...good, username: "amina kamara" }), null);
  assert.notEqual(validateNewStaffAccount({ ...good, username: "amina@mtec" }), null);
});

test("admin is not an assignable staff role", () => {
  assert.notEqual(validateNewStaffAccount({ ...good, role: "admin" }), null);
});
