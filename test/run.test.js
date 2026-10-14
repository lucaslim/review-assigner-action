import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../src/select.js";
import { run } from "../src/run.js";

function fixture(overrides = {}) {
  const calls = [];
  const records = {
    pull: { number: 42, user: { login: "author" }, draft: false, requested_reviewers: [] },
    reviews: [], members: [{ login: "alice", type: "User" }, { login: "bob", type: "User" }],
    pulls: [], events: [], ...overrides,
  };
  const method = (name, data) => async (params) => {
    calls.push([name, params]);
    if (name === "members" && records.teamError) throw records.teamError;
    return { data: typeof data === "function" ? data(params) : data };
  };
  const client = {
    rest: {
      pulls: {
        get: method("get", records.pull), listReviews: method("reviews", records.reviews),
        list: method("pulls", records.pulls), requestReviewers: method("request", {}),
      },
      teams: { listMembersInOrg: method("members", records.members) },
      issues: { listEventsForRepo: method("events", records.events), createComment: method("comment", {}) },
    },
    paginate: async (fn, params) => (await fn(params)).data,
  };
  const core = {
    info: message => calls.push(["info", message]),
    warning: message => calls.push(["warning", message]),
    setOutput: (name, value) => calls.push(["output", name, value]),
  };
  const context = {
    eventName: "pull_request", payload: {
      action: "labeled", number: 42, label: { name: "needs-review" },
      sender: { login: "labeler" },
      pull_request: { draft: true, user: { login: "stale-author" } },
    },
  };
  const config = parseConfig({ token: "secret", team: "frontend", ...overrides.inputs }, { owner: "acme", repo: "app" });
  return { config, context, client, core, calls };
}
const execute = f => run(f.config, f.context, f.client, f.core);
const effects = f => f.calls.filter(([name]) => ["comment", "request", "warning", "output"].includes(name));

test("other labels, actions and event names are ignored without API calls", async () => {
  for (const change of [f => f.context.payload.label.name = "other", f => f.context.payload.action = "opened", f => f.context.eventName = "issues"]) {
    const f = fixture();
    change(f);
    assert.deepEqual(await execute(f), { kind: "ignored" });
    assert.deepEqual(f.calls, [["output", "reviewers", ""], ["info", "Ignoring event. Review assignment requires the configured label on a pull_request labeled event."]]);
  }
});
test("fresh draft state comments without requesting reviews", async () => {
  const f = fixture({ pull: { number: 42, user: { login: "author" }, draft: true, requested_reviewers: [] } });
  f.context.payload.pull_request.draft = false;
  assert.deepEqual(await execute(f), { kind: "draft" });
  assert.deepEqual(effects(f), [
    ["output", "reviewers", ""],
    ["comment", { owner: "acme", repo: "app", issue_number: 42, body: 'Review can be assigned once this pull request is marked ready for review. Then remove and re-add the "needs-review" label.' }],
  ]);
});
test("happy path requests the lowest-load member using fresh state", async () => {
  const f = fixture({ pulls: [{ requested_reviewers: [{ login: "alice" }] }] });
  assert.deepEqual(await execute(f), { kind: "requested", reviewers: ["bob"] });
  assert.deepEqual(effects(f), [
    ["request", { owner: "acme", repo: "app", pull_number: 42, reviewers: ["bob"] }],
    ["output", "reviewers", "bob"],
  ]);
  assert.deepEqual(f.calls.find(([name]) => name === "pulls"), ["pulls", { owner: "acme", repo: "app", state: "open", per_page: 100 }]);
});
test("author, labeler, requested, reviewed, excluded and bots are never requested", async () => {
  const f = fixture({
    members: ["author", "labeler", "requested", "reviewed", "excluded", "robot[bot]", "bot", "eligible"].map(login => ({ login, type: login === "bot" ? "Bot" : "User" })),
    pull: { number: 42, user: { login: "AUTHOR" }, draft: false, requested_reviewers: [{ login: "requested" }] },
    reviews: [{ user: { login: "reviewed" }, submitted_at: "2026-04-01", state: "APPROVED" }, { user: { login: "eligible" }, submitted_at: null, state: "PENDING" }],
    inputs: { exclude: "EXCLUDED", count: "9" },
  });
  assert.deepEqual(await execute(f), { kind: "requested", reviewers: ["eligible"] });
  assert.deepEqual(effects(f), [["request", { owner: "acme", repo: "app", pull_number: 42, reviewers: ["eligible"] }], ["output", "reviewers", "eligible"]]);
});
test("re-adding the label selects a different currently unrequested member", async () => {
  const f = fixture({ pull: { number: 42, user: { login: "author" }, draft: false, requested_reviewers: [{ login: "alice" }] } });
  assert.deepEqual(await execute(f), { kind: "requested", reviewers: ["bob"] });
});
test("no candidates posts an explanation and warning", async () => {
  const f = fixture({ inputs: { exclude: "alice,bob" } });
  assert.deepEqual(await execute(f), { kind: "no-candidates" });
  const body = "No eligible member of @acme/frontend was found. All members are excluded, already requested, have already reviewed, are the PR author or labeler, or are bots.";
  assert.deepEqual(effects(f), [
    ["output", "reviewers", ""],
    ["comment", { owner: "acme", repo: "app", issue_number: 42, body }],
    ["warning", body],
  ]);
});
test("403 and 404 team failures name the missing permission", async () => {
  for (const status of [403, 404]) {
    const f = fixture({ teamError: Object.assign(new Error("Forbidden"), { status }) });
    await assert.rejects(execute(f), { message: "Cannot list members of @acme/frontend. The token needs organization Members: read permission. Verify the organization and team slug also exist." });
    assert.deepEqual(effects(f), []);
  }
});
test("other API errors propagate without translation or successful output", async () => {
  const f = fixture({ teamError: Object.assign(new Error("Unavailable"), { status: 500 }) });
  await assert.rejects(execute(f), { message: "Unavailable" });
  assert.deepEqual(effects(f), []);
});
test("tie-break uses requested_reviewer rather than the actor and newest matching event", async () => {
  const f = fixture({ events: [
    { event: "review_requested", actor: { login: "bob" }, requested_reviewer: { login: "alice" }, created_at: "2026-04-03" },
    { event: "review_requested", requested_reviewer: { login: "bob" }, created_at: "2026-04-02" },
    { event: "review_requested", requested_reviewer: { login: "alice" }, created_at: "2026-04-01" },
    { event: "review_request_removed", requested_reviewer: { login: "bob" }, created_at: "2026-04-04" },
  ] });
  assert.deepEqual(await execute(f), { kind: "requested", reviewers: ["bob"] });
});
test("event history is capped at three pages of 100", async () => {
  const f = fixture({ events: Array.from({ length: 100 }, () => ({ event: "labeled" })) });
  assert.deepEqual(await execute(f), { kind: "requested", reviewers: ["alice"] });
  assert.deepEqual(f.calls.filter(([name]) => name === "events"), [1, 2, 3].map(page => ["events", { owner: "acme", repo: "app", per_page: 100, page }]));
});
test("review request failures do not publish successful output", async () => {
  const f = fixture();
  f.client.rest.pulls.requestReviewers = async () => { throw new Error("Request failed"); };
  await assert.rejects(execute(f), { message: "Request failed" });
  assert.deepEqual(effects(f), []);
});
