import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { getOctokit } from "@actions/github";
import { parseInputs } from "../src/select.js";
import { run } from "../src/run.js";

test("real Octokit paginates members, reviews and open pulls before requesting review", async t => {
  const requests = [];
  const outputs = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    url.pathname = decodeURIComponent(url.pathname);
    requests.push([request.method, url.pathname, Object.fromEntries(url.searchParams)]);
    const page = url.searchParams.get("page") ?? "1";
    response.setHeader("content-type", "application/json");
    if (["/orgs/acme/teams/frontend/members", "/repos/acme/app/pulls", "/repos/acme/app/pulls/42/reviews"].includes(url.pathname) && page === "1") {
      response.setHeader("link", `<http://127.0.0.1:${server.address().port}${url.pathname}?per_page=100&page=2>; rel="next"`);
    }
    switch (url.pathname) {
      case "/repos/acme/app/pulls/42":
        response.end(JSON.stringify({ number: 42, user: { login: "author" }, draft: false, head: { sha: "fresh-head-sha" }, base: { ref: "main" }, requested_reviewers: [] }));
        break;
      case "/repos/acme/app/contents/.github/review-assigner.yml":
        response.end(JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from("team: frontend").toString("base64") }));
        break;
      case "/orgs/acme/teams/frontend/members":
        response.end(JSON.stringify(page === "1" ? [{ login: "alice", type: "User" }] : [{ login: "bob", type: "User" }, { login: "carol", type: "User" }]));
        break;
      case "/repos/acme/app/pulls/42/reviews":
        response.end(JSON.stringify(page === "1" ? [] : [{ user: { login: "carol" }, submitted_at: "2026-04-01" }]));
        break;
      case "/repos/acme/app/pulls":
        response.end(JSON.stringify(page === "1" ? [] : [{ requested_reviewers: [{ login: "alice" }] }]));
        break;
      case "/repos/acme/app/pulls/42/requested_reviewers": {
        let body = "";
        for await (const chunk of request) body += chunk;
        requests.push(["body", JSON.parse(body)]);
        response.end("{}");
        break;
      }
      default:
        response.statusCode = 404;
        response.end('{}');
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const config = parseInputs({ token: "test-token" }, { owner: "acme", repo: "app" });
  const client = getOctokit(config.token, { baseUrl: `http://127.0.0.1:${server.address().port}` });
  assert.deepEqual(await run(config, {
    eventName: "pull_request", payload: { number: 42, action: "labeled", label: { name: "needs-review" }, sender: { login: "labeler" } },
  }, client, { info() {}, warning() {}, setOutput: (name, value) => outputs.push([name, value]) }), { kind: "requested", reviewers: ["bob"] });
  assert.deepEqual(outputs, [["reviewers", "bob"]]);
  assert.deepEqual(requests.find(([, path]) => path.includes("/contents/")), ["GET", "/repos/acme/app/contents/.github/review-assigner.yml", { ref: "main" }]);
  assert.deepEqual(requests.filter(([method]) => method === "body"), [["body", { reviewers: ["bob"] }]]);
  assert.deepEqual(requests.filter(([, , query]) => query?.page === "2"), [
    ["GET", "/repos/acme/app/pulls/42/reviews", { per_page: "100", page: "2" }],
    ["GET", "/orgs/acme/teams/frontend/members", { per_page: "100", page: "2" }],
    ["GET", "/repos/acme/app/pulls", { per_page: "100", page: "2" }],
  ]);
});
