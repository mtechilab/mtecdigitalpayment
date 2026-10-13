import { test } from "node:test";
import assert from "node:assert/strict";
import { validateQuiz, validateAnswers, countCorrect, MAX_QUESTIONS } from "../src/services/quizPolicy.ts";

const q = (over = {}) => ({ question: "Which device connects a LAN?", options: ["Switch", "Printer"], correctIndex: 0, ...over });
const quiz = (over = {}) => ({ title: "Networking basics", programme: "Diploma in Computer Science", questions: [q()], ...over });

test("a valid quiz is accepted", () => {
  assert.equal(validateQuiz(quiz()), null);
});

test("a quiz needs at least one question and no more than the limit", () => {
  assert.notEqual(validateQuiz(quiz({ questions: [] })), null);
  assert.notEqual(validateQuiz(quiz({ questions: Array.from({ length: MAX_QUESTIONS + 1 }, () => q()) })), null);
});

test("the correct answer must be one of the options", () => {
  assert.notEqual(validateQuiz(quiz({ questions: [q({ correctIndex: 2 })] })), null);
  assert.notEqual(validateQuiz(quiz({ questions: [q({ correctIndex: -1 })] })), null);
});

test("a question needs at least two options", () => {
  assert.notEqual(validateQuiz(quiz({ questions: [q({ options: ["Only one"], correctIndex: 0 })] })), null);
});

test("answers must cover every question with a valid option", () => {
  assert.equal(validateAnswers([0, 1], [2, 2]), null);
  assert.notEqual(validateAnswers([0], [2, 2]), null);
  assert.notEqual(validateAnswers([0, 5], [2, 2]), null);
  assert.notEqual(validateAnswers([0, "1"], [2, 2]), null);
});

test("the score counts matching answers", () => {
  assert.equal(countCorrect([0, 1, 2], [0, 0, 2]), 2);
  assert.equal(countCorrect([1, 1], [0, 0]), 0);
});
