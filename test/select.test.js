import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInputs, selectReviewers } from "../src/select.js";

import { parseRotation } from "../src/config.js";
const config = (source = "team: frontend") => parseRotation(source);
const select = (overrides = {}) => selectReviewers({
  members: ["alice", "bob", "carol"],
  excluded: new Set(), load: new Map(), random: () => 0.999,
  count: config().count, ...overrides,
});

test("lowest current load wins", () => {
  assert.deepEqual(select({ load: new Map([["alice", 2], ["bob", 0], ["carol", 1]]) }), ["bob"]);
});
test("equal load uses the injected random source", () => {
  assert.deepEqual(select({ random: () => 0.999 }), ["alice"]);
  assert.deepEqual(select({ random: () => 0 }), ["bob"]);
});
test("load takes priority over random order", () => {
  assert.deepEqual(select({ random: () => 0, load: new Map([["bob", 1], ["carol", 2]]) }), ["alice"]);
});
test("fixed random sources use a stable candidate pre-order", () => {
  assert.deepEqual(select({ members: ["carol", "bob", "alice"], random: () => 0 }), ["bob"]);
});
test("excluded logins are not picked regardless of case", () => {
  assert.deepEqual(select({ excluded: new Set(["ALICE", "bob"]) }), ["carol"]);
});
test("count beyond available candidates returns every eligible member once", () => {
  assert.deepEqual(select({ members: ["bob", "alice", "bob"], count: config("team: frontend\ncount: 5").count }), ["alice", "bob"]);
});
test("no eligible members returns an empty list", () => {
  assert.deepEqual(select({ excluded: new Set(["alice", "bob", "carol"]) }), []);
});
test("action settings parse defaults and reject empty values", () => {
  const settings = inputs => parseInputs({ token: "secret", ...inputs }, { owner: "acme", repo: "app" });
  assert.deepEqual(settings({}), { token: "secret", org: "acme", repo: "app", label: "needs-review", configPath: ".github/review-assigner.yml" });
  assert.throws(() => settings({ token: "" }), /token is required/);
  assert.throws(() => settings({ label: " " }), /label is required/);
  assert.throws(() => settings({ configPath: " " }), /configPath is required/);
});
