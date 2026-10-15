import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProfilePhoto, extensionFor, MAX_PHOTO_BYTES } from "../src/services/profilePhotoPolicy.ts";

test("JPG, PNG and WEBP photos are accepted", () => {
  assert.equal(validateProfilePhoto("image/jpeg", "aGVsbG8="), null);
  assert.equal(validateProfilePhoto("image/png", "aGVsbG8="), null);
  assert.equal(validateProfilePhoto("image/webp", "aGVsbG8="), null);
});

test("other file types are refused", () => {
  assert.notEqual(validateProfilePhoto("application/pdf", "aGVsbG8="), null);
  assert.notEqual(validateProfilePhoto("image/gif", "aGVsbG8="), null);
});

test("photos over 2 MB are refused", () => {
  const big = "A".repeat(Math.ceil((MAX_PHOTO_BYTES + 10) * 4 / 3));
  assert.notEqual(validateProfilePhoto("image/jpeg", big), null);
});

test("an unreadable or empty photo is refused", () => {
  assert.notEqual(validateProfilePhoto("image/jpeg", "not base64!"), null);
  assert.notEqual(validateProfilePhoto("image/jpeg", ""), null);
});

test("each type gets its own file extension", () => {
  assert.equal(extensionFor("image/png"), "png");
  assert.equal(extensionFor("image/webp"), "webp");
  assert.equal(extensionFor("image/jpeg"), "jpg");
});
