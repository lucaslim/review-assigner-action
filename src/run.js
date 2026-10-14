import { selectReviewers } from "./select.js";

/**
 * @typedef {import('./select.js').Config} Config
 * @typedef {ReturnType<typeof import('@actions/github').getOctokit>} Client
 * @typedef {Pick<typeof import('@actions/core'), 'info' | 'warning' | 'setOutput'>} Reporter
 * @typedef {{ eventName: string, payload: (typeof import('@actions/github').context)['payload'] }} EventContext
 * @typedef {{ number: number, author: string, isDraft: boolean, requestedUsers: Set<string>, reviewedUsers: Set<string> }} PullSnapshot
 * @typedef {{ kind: 'ignored' } | { kind: 'draft' } | { kind: 'no-candidates' } | { kind: 'requested', reviewers: string[] }} Outcome
 */

/**
 * @param {Config} config
 * @param {EventContext} context
 * @param {Client} client
 * @param {Reporter} reporter
 * @returns {Promise<Outcome>}
 */
export async function run(config, context, client, reporter) {
  const outcome = await assignment(config, context, client);
  await reportOutcome(outcome, config, context.payload.number ?? 0, client, reporter);
  return outcome;
}

/**
 * @param {Config} config
 * @param {EventContext} context
 * @param {Client} client
 * @returns {Promise<Outcome>}
 */
async function assignment(config, context, client) {
  const { payload } = context;
  if (context.eventName !== "pull_request" || payload.action !== "labeled" || payload.label?.name !== config.label) {
    return { kind: "ignored" };
  }
  if (typeof payload.number !== "number" || !Number.isSafeInteger(payload.number) || payload.number < 1 || !payload.sender?.login) {
    throw new Error("The labeled event must include a pull request number and sender login");
  }
  const repository = { owner: config.org, repo: config.repo };
  const pullParams = { ...repository, pull_number: payload.number };
  const { data: pull } = await client.rest.pulls.get(pullParams);
  if (pull.draft) return { kind: "draft" };
  const reviews = await client.paginate(client.rest.pulls.listReviews, { ...pullParams, per_page: 100 });
  /** @type {PullSnapshot} */
  const snapshot = {
    number: pull.number, author: pull.user.login.toLowerCase(), isDraft: pull.draft ?? false,
    requestedUsers: new Set((pull.requested_reviewers ?? []).map(user => user.login.toLowerCase())),
    reviewedUsers: new Set(reviews.filter(review => review.submitted_at && review.user).map(review => review.user?.login.toLowerCase() ?? "")),
  };
  const members = await teamMembers(config, client);
  const excluded = new Set([
    ...config.exclude, snapshot.author, payload.sender.login.toLowerCase(),
    ...snapshot.requestedUsers, ...snapshot.reviewedUsers,
    ...members.filter(member => member.type === "Bot" || member.login.toLowerCase().endsWith("[bot]")).map(member => member.login.toLowerCase()),
  ]);
  const eligible = members.map(member => member.login.toLowerCase()).filter(login => !excluded.has(login));
  if (!eligible.length) return { kind: "no-candidates" };

  const pulls = await client.paginate(client.rest.pulls.list, { ...repository, state: "open", per_page: 100 });
  /** @type {Map<string, number>} */
  const load = new Map();
  for (const openPull of pulls) {
    for (const reviewer of openPull.requested_reviewers ?? []) {
      const login = reviewer.login.toLowerCase();
      load.set(login, (load.get(login) ?? 0) + 1);
    }
  }
  const lastRequestedAt = await recentRequests(config, client);
  const reviewers = selectReviewers({ members: eligible, excluded, load, lastRequestedAt, count: config.count });
  return { kind: "requested", reviewers };
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
 * @param {Config} config
 * @param {Client} client
 * @returns {Promise<Map<string, Date | undefined>>}
 */
async function recentRequests(config, client) {
  const lastRequestedAt = new Map();
  for (let page = 1; page <= 3; page++) {
    const { data: events } = await client.rest.issues.listEventsForRepo({
      owner: config.org, repo: config.repo, per_page: 100, page,
    });
    for (const event of events) {
      if (event.event !== "review_requested" || !event.requested_reviewer) continue;
      const login = event.requested_reviewer.login.toLowerCase();
      const date = new Date(event.created_at);
      const previous = lastRequestedAt.get(login);
      if (!previous || date > previous) lastRequestedAt.set(login, date);
    }
    if (events.length < 100) break;
  }
  return lastRequestedAt;
}

/**
 * @param {Outcome} outcome
 * @param {Config} config
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
      reporter.info("Ignoring event. Review assignment requires the configured label on a pull_request labeled event.");
      return;
    case "draft":
      await client.rest.issues.createComment({
        ...repository, issue_number: number,
        body: `Review can be assigned once this pull request is marked ready for review. Then remove and re-add the "${config.label}" label.`,
      });
      return;
    case "no-candidates": {
      const body = `No eligible member of @${config.org}/${config.team} was found. All members are excluded, already requested, have already reviewed, are the PR author or labeler, or are bots.`;
      await client.rest.issues.createComment({ ...repository, issue_number: number, body });
      reporter.warning(body);
    }
  }
}
