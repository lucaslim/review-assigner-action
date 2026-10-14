import { parseRotation } from "./config.js";
import { selectReviewers } from "./select.js";

/**
 * @typedef {import('./select.js').Settings} Settings
 * @typedef {import('./select.js').Config} Config
 * @typedef {ReturnType<typeof import('@actions/github').getOctokit>} Client
 * @typedef {Pick<typeof import('@actions/core'), 'info' | 'warning' | 'setOutput'>} Reporter
 * @typedef {{ eventName: string, payload: (typeof import('@actions/github').context)['payload'] }} EventContext
 * @typedef {{ number: number, author: string, isDraft: boolean, requestedUsers: Set<string>, reviewedUsers: Set<string> }} PullSnapshot
 * @typedef {{ kind: 'ignored' } | { kind: 'draft' } | { kind: 'no-candidates', team: string } | { kind: 'already-assigned', reviewers: string[] } | { kind: 'requested', reviewers: string[] }} Outcome
 */

/**
 * @param {Settings} config
 * @param {EventContext} context
 * @param {Client} client
 * @param {Reporter} reporter
 * @param {() => number} [random]
 * @returns {Promise<Outcome>}
 */
export async function run(config, context, client, reporter, random = Math.random) {
  const outcome = await assignment(config, context, client, reporter, random);
  await reportOutcome(outcome, config, context.payload.number ?? 0, client, reporter);
  return outcome;
}

/**
 * @param {Settings} settings
 * @param {EventContext} context
 * @param {Client} client
 * @param {Reporter} reporter
 * @param {() => number} random
 * @returns {Promise<Outcome>}
 */
async function assignment(settings, context, client, reporter, random) {
  const { payload } = context;
  const labeled = payload.action === "labeled" && payload.label?.name === settings.label;
  const ready = payload.action === "ready_for_review" && payload.pull_request?.labels?.some((/** @type {{ name: string }} */ label) => label.name === settings.label);
  if (context.eventName !== "pull_request" || !(labeled || ready)) return { kind: "ignored" };
  if (typeof payload.number !== "number" || !Number.isSafeInteger(payload.number) || payload.number < 1 || !payload.sender?.login) {
    throw new Error("The review assignment event must include a pull request number and sender login");
  }
  const repository = { owner: settings.org, repo: settings.repo };
  const pullParams = { ...repository, pull_number: payload.number };
  const { data: pull } = await client.rest.pulls.get(pullParams);
  if (ready && !pull.labels.some(label => label.name === settings.label)) return { kind: "ignored" };
  if (pull.draft) return { kind: "draft" };
  const config = { ...settings, ...await readRotation(settings, pull.head.sha, pull.base.ref, client, reporter) };
  const reviews = await client.paginate(client.rest.pulls.listReviews, { ...pullParams, per_page: 100 });
  /** @type {PullSnapshot} */
  const snapshot = {
    number: pull.number, author: pull.user.login.toLowerCase(), isDraft: pull.draft ?? false,
    requestedUsers: new Set((pull.requested_reviewers ?? []).map(user => user.login.toLowerCase())),
    reviewedUsers: new Set(reviews.filter(review => review.submitted_at && review.user).map(review => review.user?.login.toLowerCase() ?? "")),
  };
  const members = await teamMembers(config, client);
  if (ready) {
    const reviewers = [...new Set(members.map(member => member.login.toLowerCase()))]
      .filter(login => login !== snapshot.author && (snapshot.requestedUsers.has(login) || snapshot.reviewedUsers.has(login)));
    if (reviewers.length) return { kind: "already-assigned", reviewers };
  }
  const excluded = new Set([
    ...config.exclude, snapshot.author, payload.sender.login.toLowerCase(),
    ...snapshot.requestedUsers, ...snapshot.reviewedUsers,
    ...members.filter(member => member.type === "Bot" || member.login.toLowerCase().endsWith("[bot]")).map(member => member.login.toLowerCase()),
  ]);
  const eligible = members.map(member => member.login.toLowerCase()).filter(login => !excluded.has(login));
  if (!eligible.length) return { kind: "no-candidates", team: config.team };

  const pulls = await client.paginate(client.rest.pulls.list, { ...repository, state: "open", per_page: 100 });
  /** @type {Map<string, number>} */
  const load = new Map();
  for (const openPull of pulls) {
    for (const reviewer of openPull.requested_reviewers ?? []) {
      const login = reviewer.login.toLowerCase();
      load.set(login, (load.get(login) ?? 0) + 1);
    }
  }
  const reviewers = selectReviewers({ members: eligible, excluded, load, random, count: config.count });
  return { kind: "requested", reviewers };
}

/**
 * @param {Settings} settings
 * @param {string} head
 * @param {string} base
 * @param {Client} client
 * @param {Reporter} reporter
 */
async function readRotation(settings, head, base, client, reporter) {
  const { org: owner, repo, configPath: path } = settings;
  for (const ref of [base, head]) {
    let data;
    try {
      ({ data } = await client.rest.repos.getContent({ owner, repo, path, ref }));
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 404) continue;
      throw error;
    }
    if (Array.isArray(data) || data.type !== "file" || !("content" in data) || data.encoding !== "base64") {
      throw new Error(`Config path ${path} at ${ref} must be a file with base64 content.`);
    }
    const rotation = parseRotation(Buffer.from(data.content, "base64").toString("utf8"));
    reporter.info(`Read config ${path} at ${ref}.`);
    return rotation;
  }
  throw new Error(`Config file ${path} was not found at base ${base} or head ${head}.`);
}

/**
 * @param {Config} config
 * @param {Client} client
 */
async function teamMembers(config, client) {
  try {
    return await client.paginate(client.rest.teams.listMembersInOrg, {
      org: config.org, team_slug: config.team, per_page: 100,
    });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && (error.status === 403 || error.status === 404)) {
      throw new Error(`Cannot list members of @${config.org}/${config.team}. The token needs organization Members: read permission. Verify the organization and team slug also exist.`, { cause: error });
    }
    throw error;
  }
}

/**
 * @param {Outcome} outcome
 * @param {Settings} config
 * @param {number} number
 * @param {Client} client
 * @param {Reporter} reporter
 */
async function reportOutcome(outcome, config, number, client, reporter) {
  const repository = { owner: config.org, repo: config.repo };
  if (outcome.kind === "requested") {
    await client.rest.pulls.requestReviewers({ ...repository, pull_number: number, reviewers: outcome.reviewers });
    reporter.setOutput("reviewers", outcome.reviewers.join(","));
    reporter.info(`Requested review from ${outcome.reviewers.join(", ")}.`);
    return;
  }
  reporter.setOutput("reviewers", "");
  switch (outcome.kind) {
    case "ignored":
      reporter.info("Ignoring event. Review assignment requires the configured label on a pull_request labeled or ready_for_review event.");
      return;
    case "already-assigned":
      reporter.info(`Review already assigned to ${outcome.reviewers.join(", ")}.`);
      return;
    case "draft":
      await client.rest.issues.createComment({
        ...repository, issue_number: number,
        body: "A reviewer will be requested when this pull request is marked ready for review.",
      });
      return;
    case "no-candidates": {
      const body = `No eligible member of @${config.org}/${outcome.team} was found. All members are excluded in ${config.configPath}, already requested, have already reviewed, are the PR author or labeler, or are bots.`;
      await client.rest.issues.createComment({ ...repository, issue_number: number, body });
      reporter.warning(body);
    }
  }
}
