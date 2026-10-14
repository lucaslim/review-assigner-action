import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRotation } from "../src/config.js";

test("full YAML config normalizes exclusions", () => {
  assert.deepEqual(parseRotation("team: frontend\ncount: 2\nexclude:\n  - Alice\n  - BOB\n"), {
    team: "frontend", count: 2, exclude: new Set(["alice", "bob"]),
  });
});
test("count and exclusions default when omitted", () => {
  assert.deepEqual(parseRotation("team: frontend"), { team: "frontend", count: 1, exclude: new Set() });
});
test("unknown config keys fail with the key name", () => {
  assert.throws(() => parseRotation("team: frontend\nexlude: []"), { message: "Unknown config key: exlude" });
});
test("config rejects wrong types and invalid values", () => {
  for (const count of ['"1"', "0", "-1", "1.5", "true", "null", "9007199254740992", "[]"]) {
    assert.throws(() => parseRotation(`team: frontend\ncount: ${count}`), { message: "count must be a positive safe integer" });
  }
  for (const exclude of ['"alice"', "[alice, 1]", "null", "{}", "[true]"]) {
    assert.throws(() => parseRotation(`team: frontend\nexclude: ${exclude}`), { message: "exclude must be a list of strings" });
  }
  for (const team of ["", "1", "[]", "null"]) {
    assert.throws(() => parseRotation(`team: ${team}`), { message: "team is required and must be a string" });
  }
  assert.throws(() => parseRotation("team: acme/frontend"), { message: "team must be a team slug, not an org/team path" });
});
test("empty and non-mapping documents fail", () => {
  for (const source of ["", "# empty", "null", "frontend", "[]", "- frontend"]) {
    assert.throws(() => parseRotation(source), { message: "Config must be a non-empty YAML mapping" });
  }
  assert.throws(() => parseRotation("{}"), { message: "team is required and must be a string" });
});
