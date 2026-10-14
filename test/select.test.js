import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, selectReviewers } from "../src/select.js";

const config = (inputs = {}) => parseConfig({
  token: "secret", team: "frontend", ...inputs,
}, { owner: "acme", repo: "app" });
const select = (overrides = {}) => selectReviewers({
  members: ["alice", "bob", "carol"],
  excluded: new Set(), load: new Map(), lastRequestedAt: new Map(),
  count: config().count, ...overrides,
});

test("lowest current load wins", () => {
  assert.deepEqual(select({ load: new Map([["alice", 2], ["bob", 0], ["carol", 1]]) }), ["bob"]);
});
test("equal load uses the least recently requested reviewer", () => {
  assert.deepEqual(select({ lastRequestedAt: new Map([
    ["alice", new Date("2026-04-03")], ["bob", new Date("2026-04-01")],
    ["carol", new Date("2026-04-02")],
  ]) }), ["bob"]);
});
test("never requested wins before an older request", () => {
  assert.deepEqual(select({ lastRequestedAt: new Map([
    ["alice", new Date("2026-04-01")], ["carol", new Date("2026-04-02")],
  ]) }), ["bob"]);
});
test("login breaks otherwise equal ranks deterministically", () => {
  assert.deepEqual(select({ members: ["carol", "bob", "alice"] }), ["alice"]);
});
test("excluded logins are not picked regardless of case", () => {
  assert.deepEqual(select({ excluded: new Set(["ALICE", "bob"]) }), ["carol"]);
});
test("count beyond available candidates returns every eligible member once", () => {
  assert.deepEqual(select({ members: ["bob", "alice", "bob"], count: config({ count: "5" }).count }), ["alice", "bob"]);
});
test("no eligible members returns an empty list", () => {
  assert.deepEqual(select({ excluded: new Set(["alice", "bob", "carol"]) }), []);
});
test("config parses defaults and comma or newline exclusions", () => {
  assert.deepEqual(config({ exclude: " Alice, BOB\ncarol ,alice" }), {
    token: "secret", org: "acme", repo: "app", team: "frontend",
    label: "needs-review", count: 1, exclude: new Set(["alice", "bob", "carol"]),
  });
});
test("config rejects invalid positive integers and missing required inputs", () => {
  for (const count of ["0", "-1", "1.5", "1e2", "NaN", "9007199254740992", ""]) {
    assert.throws(() => config({ count }), /count must be a positive safe integer/);
  }
  assert.throws(() => config({ token: "" }), /token is required/);
  assert.throws(() => config({ team: "" }), /team is required/);
  assert.throws(() => config({ team: "acme/frontend" }), /team must be a team slug/);
  assert.throws(() => config({ label: " " }), /label is required/);
});
