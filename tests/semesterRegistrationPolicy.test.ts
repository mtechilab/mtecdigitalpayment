import { test } from "node:test";
import assert from "node:assert/strict";
import { windowState, amountDue, validateWindowInput, validateCourses } from "../src/services/semesterRegistrationPolicy.ts";

const win = { opensAt: "2026-09-01T00:00:00Z", closesAt: "2026-09-30T23:59:59Z", lateClosesAt: "2026-10-15T23:59:59Z", surchargePercent: 50, isOpen: true };

test("registration is upcoming, open, late, or closed by date", () => {
  assert.equal(windowState(win, new Date("2026-08-20T00:00:00Z")), "upcoming");
  assert.equal(windowState(win, new Date("2026-09-10T00:00:00Z")), "open");
  assert.equal(windowState(win, new Date("2026-10-05T00:00:00Z")), "late");
  assert.equal(windowState(win, new Date("2026-10-20T00:00:00Z")), "closed");
});

test("admin closing registration stops it at once, even inside the window", () => {
  assert.equal(windowState({ ...win, isOpen: false }, new Date("2026-09-10T00:00:00Z")), "closed");
});

test("a late registration adds the surcharge to the semester fee", () => {
  assert.equal(amountDue(1000, "open", 50), 1000);
  assert.equal(amountDue(1000, "late", 50), 1500);
  assert.equal(amountDue(1000, "late", 0), 1000);
});

test("window dates must make sense", () => {
  const ok = { opensAt: "2026-09-01T00:00:00Z", closesAt: "2026-09-30T00:00:00Z", lateClosesAt: null, surchargePercent: 50 };
  assert.equal(validateWindowInput(ok), null);
  assert.notEqual(validateWindowInput({ ...ok, closesAt: "2026-08-01T00:00:00Z" }), null);
  assert.notEqual(validateWindowInput({ ...ok, lateClosesAt: "2026-09-15T00:00:00Z" }), null);
  assert.notEqual(validateWindowInput({ ...ok, surchargePercent: 150 }), null);
});

test("courses are checked and cannot repeat", () => {
  assert.equal(validateCourses([{ code: "ACC101", name: "Principles of Accounting" }]), null);
  assert.notEqual(validateCourses([{ code: "ACC101", name: "A" }]), null);
  assert.notEqual(validateCourses([{ code: "ACC101", name: "Accounting one" }, { code: "acc101", name: "Accounting two" }]), null);
});
