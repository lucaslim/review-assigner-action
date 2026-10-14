/**
 * @typedef {number & { readonly __positiveInt: unique symbol }} PositiveInt
 * @typedef {{ token: string, org: string, repo: string, team: string, label: string, count: PositiveInt, exclude: ReadonlySet<string> }} Config
 * @typedef {{ members: readonly string[], excluded: ReadonlySet<string>, load: ReadonlyMap<string, number>, lastRequestedAt: ReadonlyMap<string, Date | undefined>, count: PositiveInt }} Selection
 */

/**
 * @param {{ token: string, team: string, label?: string, count?: string, exclude?: string }} inputs
 * @param {{ owner: string, repo: string }} repository
 * @returns {Config}
 */
export function parseConfig(inputs, repository) {
  const token = inputs.token.trim();
  const team = inputs.team.trim();
  const label = (inputs.label ?? "needs-review").trim();
  for (const [name, value] of Object.entries({ token, team, label })) {
    if (!value) throw new Error(`${name} is required`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(team)) {
    throw new Error("team must be a team slug, not an org/team path");
  }
  const rawCount = inputs.count ?? "1";
  const count = Number(rawCount);
  if (!/^[0-9]+$/.test(rawCount) || !Number.isSafeInteger(count) || count < 1) {
    throw new Error("count must be a positive safe integer");
  }
  return {
    token, org: repository.owner, repo: repository.repo, team, label,
    count: /** @type {PositiveInt} */ (count),
    exclude: new Set((inputs.exclude ?? "").split(/[,\n]/).map(login => login.trim().toLowerCase()).filter(Boolean)),
  };
}

/**
 * @param {Selection} selection
 * @returns {string[]}
 */
export function selectReviewers({ members, excluded, load, lastRequestedAt, count }) {
  const excludedLogins = new Set([...excluded].map(login => login.toLowerCase()));
  return [...new Set(members.map(login => login.toLowerCase()))]
    .filter(login => !excludedLogins.has(login))
    .sort((a, b) => {
      const loadDifference = (load.get(a) ?? 0) - (load.get(b) ?? 0);
      if (loadDifference) return loadDifference;
      const aTime = lastRequestedAt.get(a)?.getTime() ?? -Infinity;
      const bTime = lastRequestedAt.get(b)?.getTime() ?? -Infinity;
      if (aTime !== bTime) return aTime < bTime ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .slice(0, count);
}
