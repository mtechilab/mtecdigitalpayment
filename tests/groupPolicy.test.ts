import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGroupName, validateMemberList, groupHasRoom, MAX_GROUP_MEMBERS } from "../src/services/groupPolicy.ts";

const me = { kind: "student" as const, id: "11111111-1111-1111-1111-111111111111" };
const s1 = { kind: "student" as const, id: "22222222-2222-2222-2222-222222222222" };
const staff = { kind: "staff" as const, id: "33333333-3333-3333-3333-333333333333" };

test("group names are 2 to 60 characters", () => {
  assert.equal(validateGroupName("Final year project"), null);
  assert.notEqual(validateGroupName("A"), null);
  assert.notEqual(validateGroupName("x".repeat(61)), null);
});

test("students and staff can both be added", () => {
  assert.equal(validateMemberList([s1, staff], me), null);
});

test("the creator is not added twice, and no one is listed twice", () => {
  assert.notEqual(validateMemberList([me], me), null);
  assert.notEqual(validateMemberList([s1, s1], me), null);
  assert.notEqual(validateMemberList([], me), null);
  assert.notEqual(validateMemberList("not a list", me), null);
  assert.notEqual(validateMemberList([{ kind: "parent", id: "44444444-4444-4444-4444-444444444444" }], me), null);
});

test("a group stops accepting people at the limit", () => {
  assert.equal(groupHasRoom(MAX_GROUP_MEMBERS - 1), true);
  assert.equal(groupHasRoom(MAX_GROUP_MEMBERS), false);
});
