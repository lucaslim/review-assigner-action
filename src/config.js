import { parse } from "yaml";

/**
 * @param {string} source
 * @returns {Pick<import('./select.js').Config, 'team' | 'count' | 'exclude'>}
 */
export function parseRotation(source) {
  /** @type {unknown} */
  const value = parse(source, { stringKeys: true });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Config must be a non-empty YAML mapping");
  }
  for (const key of Object.keys(value)) {
    if (!["team", "count", "exclude"].includes(key)) throw new Error(`Unknown config key: ${key}`);
  }
  const team = "team" in value ? value.team : undefined;
  if (typeof team !== "string" || !team.trim()) throw new Error("team is required and must be a string");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(team.trim())) {
    throw new Error("team must be a team slug, not an org/team path");
  }
  const count = "count" in value ? value.count : 1;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) {
    throw new Error("count must be a positive safe integer");
  }
  const exclude = "exclude" in value ? value.exclude : [];
  if (!Array.isArray(exclude) || !exclude.every(login => typeof login === "string")) {
    throw new Error("exclude must be a list of strings");
  }
  return {
    team: team.trim(), count: /** @type {import('./select.js').PositiveInt} */ (count),
    exclude: new Set(exclude.map(login => login.trim().toLowerCase()).filter(Boolean)),
  };
}
