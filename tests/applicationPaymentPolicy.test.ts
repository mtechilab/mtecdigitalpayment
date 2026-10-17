import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLevel, validateReference, validateFeeAmount, validateReceipt, paymentPrecheck } from "../src/services/applicationPaymentPolicy.ts";

test("only certificate and diploma are programme levels", () => {
  assert.equal(validateLevel("certificate"), true);
  assert.equal(validateLevel("diploma"), true);
  assert.equal(validateLevel("degree"), false);
  assert.equal(validateLevel(undefined), false);
});

test("an Orange Money reference must be 6 to 40 safe characters", () => {
  assert.equal(validateReference("MP250101-123456"), null);
  assert.notEqual(validateReference("12345"), null);
  assert.notEqual(validateReference("ABC 123 456"), null);
  assert.notEqual(validateReference("x".repeat(41)), null);
});

test("fees must be positive and sensible", () => {
  assert.equal(validateFeeAmount(100), null);
  assert.notEqual(validateFeeAmount(0), null);
  assert.notEqual(validateFeeAmount(-5), null);
  assert.notEqual(validateFeeAmount("100"), null);
  assert.notEqual(validateFeeAmount(1e9), null);
});

test("receipts must be a JPG, PNG or WEBP photo up to 5 MB", () => {
  assert.equal(validateReceipt("image/jpeg", "aGVsbG8="), null);
  assert.notEqual(validateReceipt("application/pdf", "aGVsbG8="), null);
  assert.notEqual(validateReceipt("image/png", "not base64!"), null);
  assert.notEqual(validateReceipt("image/png", "A".repeat(Math.ceil((5 * 1024 * 1024 + 10) * 4 / 3))), null);
});

test("payment is open only once, and only while the application is still open", () => {
  assert.equal(paymentPrecheck("submitted", false, false), null);
  assert.notEqual(paymentPrecheck("submitted", true, false), null);
  assert.notEqual(paymentPrecheck("submitted", false, true), null);
  assert.notEqual(paymentPrecheck("rejected", false, false), null);
});
