/**
 * @typedef {number & { readonly __positiveInt: unique symbol }} PositiveInt
 * @typedef {{ token: string, org: string, repo: string, label: string, configPath: string }} Settings
 * @typedef {Settings & { team: string, count: PositiveInt, exclude: ReadonlySet<string> }} Config
 * @typedef {{ members: readonly string[], excluded: ReadonlySet<string>, load: ReadonlyMap<string, number>, lastRequestedAt: ReadonlyMap<string, Date | undefined>, count: PositiveInt }} Selection
 */

/**
 * @param {{ token: string, label?: string, configPath?: string }} inputs
 * @param {{ owner: string, repo: string }} repository
 * @returns {Settings}
 */
export function parseInputs(inputs, repository) {
  const token = inputs.token.trim();
  const configPath = (inputs.configPath ?? ".github/review-assigner.yml").trim();
  const label = (inputs.label ?? "needs-review").trim();
  for (const [name, value] of Object.entries({ token, configPath, label })) {
    if (!value) throw new Error(`${name} is required`);
  }
  return { token, org: repository.owner, repo: repository.repo, label, configPath };
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
