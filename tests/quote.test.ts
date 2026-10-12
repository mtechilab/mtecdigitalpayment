import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteFrequency, quoteAllFrequencies, FREQUENCY_STEP_DAYS } from "../src/services/paymentQuote.ts";

test("daily, weekly and monthly suggestions divide what is owed across the days left", () => {
  assert.equal(quoteFrequency(1000, 100, "daily").suggestedAmount, 10);
  assert.equal(quoteFrequency(1000, 100, "weekly").suggestedAmount, 66.67);
  assert.equal(quoteFrequency(1000, 100, "monthly").suggestedAmount, 250);
});

test("semester and yearly are a single payment when the plan has under a year left", () => {
  assert.equal(quoteFrequency(1000, 100, "semester").suggestedAmount, 1000);
  assert.equal(quoteFrequency(1000, 100, "yearly").suggestedAmount, 1000);
});

test("the maximum is always everything owed", () => {
  assert.equal(quoteFrequency(1000, 100, "monthly").maxAmount, 1000);
});

test("an ended plan makes the whole balance due at once", () => {
  assert.equal(quoteFrequency(500, 0, "daily").suggestedAmount, 500);
});

test("nothing owed means nothing suggested", () => {
  assert.equal(quoteFrequency(0, 100, "monthly").suggestedAmount, 0);
});

test("a suggestion never exceeds the maximum, at any frequency", () => {
  for (const q of quoteAllFrequencies(333.33, 47)) assert.ok(q.suggestedAmount <= q.maxAmount, q.frequency);
});

test("yearly uses a 365-day step", () => {
  assert.equal(FREQUENCY_STEP_DAYS.yearly, 365);
});
