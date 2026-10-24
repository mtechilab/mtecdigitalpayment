import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedFields, validateReason } from "../src/services/adminDataPolicy.ts";

test("only the fields a table allows can be changed", () => {
  assert.equal(allowedFields("students", { phone: "0770000000" }).ok, true);
  assert.equal(allowedFields("students", { password_hash: "x" }).ok, false);
  assert.equal(allowedFields("students", { student_id: "MTEC-2026-00099" }).ok, false);
  assert.equal(allowedFields("unknown_table", { a: 1 }).ok, false);
  assert.equal(allowedFields("students", {}).ok, false);
});

test("the change log needs a real reason", () => {
  assert.equal(validateReason("Typing error in surname"), null);
  assert.notEqual(validateReason("ok"), null);
  assert.notEqual(validateReason(""), null);
});
