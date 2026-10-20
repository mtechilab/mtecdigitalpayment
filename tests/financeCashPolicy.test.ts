import { test } from "node:test";
import assert from "node:assert/strict";
import { canRecordCash, validateCashAmount, validateClientReference, receiptText } from "../src/services/financeCashPolicy.ts";

test("only finance officers and administrators record cash", () => {
  assert.equal(canRecordCash("finance"), true);
  assert.equal(canRecordCash("administrator"), true);
  assert.equal(canRecordCash("lecturer"), false);
  assert.equal(canRecordCash("staff"), false);
});

test("cash amounts must be positive and sensible", () => {
  assert.equal(validateCashAmount(500), null);
  assert.notEqual(validateCashAmount(0), null);
  assert.notEqual(validateCashAmount(-5), null);
  assert.notEqual(validateCashAmount(1e9), null);
});

test("each offline payment carries a unique reference", () => {
  assert.equal(validateClientReference("DEV01-20261005-0001"), null);
  assert.notEqual(validateClientReference("short"), null);
  assert.notEqual(validateClientReference("bad ref with spaces"), null);
});

test("the receipt text matches the finance office format", () => {
  const text = receiptText({ receiptNumber: "MTEC-2026-0019", studentName: "Isatu Marah", amount: 500, paymentType: "Tuition Fees", balance: 500, date: "2026-10-05T09:22:49" });
  assert.equal(text, "MTeC Payment Receipt\nMTEC-2026-0019\nIsatu Marah\nPaid: NLe 500.00 (Tuition Fees)\nBalance: NLe 500.00\n2026-10-05T09:22:49\nThank you - MTeC Finance");
});
