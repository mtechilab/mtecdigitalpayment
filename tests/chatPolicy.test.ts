import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReaction, deleteScope, isReadBy, previewOf, isTypingNow, PREVIEW_CHARS } from "../src/services/chatPolicy.ts";

test("only the six listed reactions are accepted", () => {
  assert.equal(validateReaction("love"), true);
  assert.equal(validateReaction("angry"), false);
  assert.equal(validateReaction(undefined), false);
});

test("delete scope is 'me' or 'everyone' and nothing else", () => {
  assert.equal(deleteScope("me"), "me");
  assert.equal(deleteScope("everyone"), "everyone");
  assert.equal(deleteScope("all"), null);
});

test("a message is read once the reader's time reaches its time", () => {
  assert.equal(isReadBy("2026-10-16T10:05:00Z", "2026-10-16T10:00:00Z"), true);
  assert.equal(isReadBy("2026-10-16T09:59:00Z", "2026-10-16T10:00:00Z"), false);
});

test("quoted previews are short and handle deleted and media messages", () => {
  assert.equal(previewOf(null, "text", true), "This message was deleted");
  assert.equal(previewOf(null, "voice", false), "Voice note");
  assert.equal(previewOf(null, "image", false), "Photo");
  assert.equal(previewOf("x".repeat(200), "text", false).length, PREVIEW_CHARS);
});

test("typing shows for a few seconds only", () => {
  const now = new Date("2026-10-16T10:00:10Z");
  assert.equal(isTypingNow("2026-10-16T10:00:07Z", now), true);
  assert.equal(isTypingNow("2026-10-16T09:59:00Z", now), false);
});
