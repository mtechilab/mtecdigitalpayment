import { test } from "node:test";
import assert from "node:assert/strict";
import { validateText, validateVoice, groupAccessRule, unreadCount, MAX_VOICE_SECONDS } from "../src/services/messagingPolicy.ts";

test("a message must have text and stay under the limit", () => {
  assert.notEqual(validateText("   "), null);
  assert.equal(validateText("Good morning"), null);
  assert.notEqual(validateText("x".repeat(2001)), null);
});

test("a voice note must be a supported format, up to 2 minutes and 2 MB", () => {
  assert.equal(validateVoice("audio/mp4", "aGVsbG8=", 12), null);
  assert.notEqual(validateVoice("video/mp4", "aGVsbG8=", 12), null);
  assert.notEqual(validateVoice("audio/mp4", "aGVsbG8=", MAX_VOICE_SECONDS + 1), null);
  assert.notEqual(validateVoice("audio/mp4", "aGVsbG8=", 0), null);
  assert.notEqual(validateVoice("audio/mp4", "A".repeat(Math.ceil((2 * 1024 * 1024 + 10) * 4 / 3)), 10), null);
});

test("each group kind maps to its access rule", () => {
  assert.equal(groupAccessRule("programme"), "all-students-of-programme");
  assert.equal(groupAccessRule("class"), "class-members");
  assert.equal(groupAccessRule("direct"), "direct-members");
});

test("unread counts leave out the viewer's own messages", () => {
  const msgs = [
    { senderKind: "staff", senderId: "a" },
    { senderKind: "student", senderId: "s1" },
    { senderKind: "student", senderId: "s1" },
  ];
  assert.equal(unreadCount(msgs, "student", "s1"), 1);
  assert.equal(unreadCount(msgs, "student", "s2"), 3);
});
