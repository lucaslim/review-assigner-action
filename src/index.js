import * as core from "@actions/core";
import * as github from "@actions/github";
import { parseConfig } from "./select.js";
import { run } from "./run.js";

async function main() {
  const config = parseConfig({
    token: core.getInput("token", { required: true }),
    team: core.getInput("team", { required: true }),
    label: core.getInput("label"),
    count: core.getInput("count"),
    exclude: core.getInput("exclude"),
  }, github.context.repo);
  await run(config, github.context, github.getOctokit(config.token), core);
}

main().catch(error => core.setFailed(error instanceof Error ? error.message : String(error)));
