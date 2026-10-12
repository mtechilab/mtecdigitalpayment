import { test } from "node:test";
import assert from "node:assert/strict";
import { findOrderNumber } from "../src/services/orderNumber.ts";

test("finds an order number under an order-named key", () => {
  assert.equal(findOrderNumber({ data: { processedPaymentData: { orderNumber: "YXQP-M1KP-BUD4" } } }), "YXQP-M1KP-BUD4");
});

test("finds the first short string inside an order object", () => {
  assert.equal(findOrderNumber({ data: { order: { number: "ABCD-1234" } } }), "ABCD-1234");
});

test("returns null when no order number is present", () => {
  assert.equal(findOrderNumber({ data: { paymentId: "x", reference: "y" } }), null);
});

test("ignores values that are too short to be an order number", () => {
  assert.equal(findOrderNumber({ orderId: "ab" }), null);
});
