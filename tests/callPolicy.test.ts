import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCallMode, validateSignal, isRingExpired, durationSeconds, parseIceServers, DEFAULT_ICE_SERVERS } from "../src/services/callPolicy.ts";

test("only audio and video calls are accepted", () => {
  assert.equal(validateCallMode("audio"), true);
  assert.equal(validateCallMode("video"), true);
  assert.equal(validateCallMode("screen"), false);
});

test("signals must be a known kind with an object payload, and not too large", () => {
  assert.equal(validateSignal("offer", { sdp: "v=0" }), null);
  assert.notEqual(validateSignal("drop-table", {}), null);
  assert.notEqual(validateSignal("ice", null), null);
  assert.notEqual(validateSignal("ice", { candidate: "x".repeat(30000) }), null);
});

test("an unanswered call stops ringing after 60 seconds", () => {
  const now = new Date("2026-10-17T10:01:30Z");
  assert.equal(isRingExpired("2026-10-17T10:01:00Z", now), false);
  assert.equal(isRingExpired("2026-10-17T10:00:00Z", now), true);
});

test("call duration is whole seconds and never negative", () => {
  assert.equal(durationSeconds("2026-10-17T10:00:00Z", "2026-10-17T10:02:34Z"), 154);
  assert.equal(durationSeconds("2026-10-17T10:02:00Z", "2026-10-17T10:00:00Z"), 0);
});

test("ICE settings fall back to STUN when missing or malformed", () => {
  assert.deepEqual(parseIceServers(undefined), DEFAULT_ICE_SERVERS);
  assert.deepEqual(parseIceServers("not json"), DEFAULT_ICE_SERVERS);
  assert.deepEqual(parseIceServers("[{\"urls\": 5}]"), DEFAULT_ICE_SERVERS);
  const relay = '[{"urls":"turn:relay.example:3478","username":"u","credential":"c"}]';
  assert.equal(parseIceServers(relay)[0].urls, "turn:relay.example:3478");
});
