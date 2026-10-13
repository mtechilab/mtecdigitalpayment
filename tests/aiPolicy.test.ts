import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDraftRequest, buildMessages, budgetAllows, extractDraftText, DRAFT_KINDS, MAX_OUTPUT_CHARS, validateConceptQuestion, buildConceptMessages } from "../src/services/aiPolicy.ts";

const good = { kind: "lesson_plan", title: "Introduction to databases", programme: "Diploma in Computer Science" };

test("a valid request is accepted", () => {
  assert.equal(validateDraftRequest(good), null);
});

test("only the listed material types are accepted", () => {
  assert.notEqual(validateDraftRequest({ ...good, kind: "video" }), null);
  assert.equal(DRAFT_KINDS.length, 7);
});

test("the title and programme have length limits", () => {
  assert.notEqual(validateDraftRequest({ ...good, title: "ab" }), null);
  assert.notEqual(validateDraftRequest({ ...good, programme: "x" }), null);
});

test("long notes are refused", () => {
  assert.notEqual(validateDraftRequest({ ...good, instructions: "x".repeat(1001) }), null);
});

test("the prompt names the material and keeps the lecturer's notes in the user message", () => {
  const msgs = buildMessages({ ...good, instructions: "Use a hospital example" });
  assert.equal(msgs[0].role, "system");
  assert.match(msgs[0].content, /Do not invent references/);
  assert.match(msgs[1].content, /Material type: lesson plan/);
  assert.match(msgs[1].content, /Lecturer's notes: Use a hospital example/);
  assert.doesNotMatch(msgs[0].content, /Use a hospital example/);
});

test("the monthly budget stops calls at the limit", () => {
  assert.equal(budgetAllows(199, 200), true);
  assert.equal(budgetAllows(200, 200), false);
});

test("a provider reply yields its text and token count", () => {
  const r = extractDraftText({ choices: [{ message: { content: "Week 1: ..." } }], usage: { total_tokens: 812 } });
  assert.deepEqual(r, { text: "Week 1: ...", tokens: 812 });
});

test("an empty or malformed provider reply yields nothing", () => {
  assert.equal(extractDraftText({ choices: [] }), null);
  assert.equal(extractDraftText({ choices: [{ message: { content: "   " } }] }), null);
  assert.equal(extractDraftText(null), null);
});

test("an over-long reply is cut to the storage limit", () => {
  const r = extractDraftText({ choices: [{ message: { content: "a".repeat(MAX_OUTPUT_CHARS + 500) } }] });
  assert.equal(r?.text.length, MAX_OUTPUT_CHARS);
});

test("a concept question must be 3 to 500 characters", () => {
  assert.notEqual(validateConceptQuestion("hi"), null);
  assert.equal(validateConceptQuestion("What is a binary number?"), null);
  assert.notEqual(validateConceptQuestion("x".repeat(501)), null);
});

test("the concept prompt keeps student records out of the answer", () => {
  const msgs = buildConceptMessages("What is ohm's law?");
  assert.match(msgs[0].content, /fees, payments, results/);
  assert.equal(msgs[1].content, "What is ohm's law?");
});
