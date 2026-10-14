# Review assigner action

Adding `needs-review` to a non-draft PR requests review from the least-loaded eligible member of a GitHub team. The label stays on the PR. Remove and re-add it to request another person. Each label addition requests up to `count` new reviewers. Marking a draft PR ready for review also requests reviewers if it has the label. If any team member other than the author is already requested or has submitted a review, the ready event requests nobody. It logs those members and posts no comment. Re-adding the label still requests more reviewers.

When the PR has a pending review request for the configured team, for example from `CODEOWNERS`, the action removes that team request after requesting the selected reviewers or after the ready event finds an assigned team member. Only the person is left requested. Other team requests stay. If the reviewer request fails, the team request stays. A branch protection rule that requires code owner review can stop GitHub from removing a code owner team. If GitHub rejects the removal with 422, the action emits a warning and keeps the requested reviewer.

Load is the number of open PRs in this repository currently requesting that person's review. Equal loads use a uniform random tie-break.

The author, event sender, bots, excluded logins, current requested reviewers, and people who already submitted a review are ineligible. The event sender is the person who added the label or marked the PR ready. Draft PRs receive a comment explaining that assignment will happen when they are marked ready. If nobody is eligible, the action comments and emits a warning.

## Inputs and output

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `token` | Yes | | GitHub App installation token. |
| `label` | No | `needs-review` | Label that triggers assignment. |
| `config-path` | No | `.github/review-assigner.yml` | YAML rotation config path on the base branch, falling back to the PR head commit only on 404. |

The `reviewers` output contains comma-separated requested logins. It is empty when the event is ignored, the PR is a draft, a ready event already has an assigned team member, or nobody is eligible. API errors and invalid configuration fail the run.

## Config file

v2 removes the `team`, `count`, and `exclude` inputs and reads them from a YAML config file instead.

Add `.github/review-assigner.yml` to the consumer repository:

```yaml
team: retail-frontend-codeowners
count: 1
exclude:
  - someone
```

`team` is required and must be a team slug in the repository owner's organization, not an organization/team path. `count` defaults to `1` and must be a positive safe integer. If fewer members are eligible, the action requests all of them. `exclude` defaults to an empty list and must be a list of logins, matched without case sensitivity.

The action reads the file at the PR's base branch, after checking that the PR is not a draft. Rotation changes take effect once merged into the base branch. Only if the base returns 404 does the action read the file at the fresh PR head commit. This fallback lets a PR introduce the config file before it merges. The log names the ref used. If both refs return 404, the run fails with the path and both refs. Other API errors fail without falling back. Empty files, non-mapping documents, unknown keys, and wrong value types fail the run before any review request.

## Required app permissions

Install the GitHub App in the repository owner's organization with these permissions:

- Repository Pull requests, write.
- Repository Contents, read.
- Organization Members, read.

The installation token must retain all three permissions. `GITHUB_TOKEN` cannot read organization team membership. Eligible members also need access to the repository.

## Usage

Store the app ID in `REVIEW_ASSIGNER_APP_ID` and its private key in `REVIEW_ASSIGNER_PRIVATE_KEY`. Serialize runs per PR so label and ready events do not select from the same stale snapshot. Do not check out or execute PR code with the app token. Fork PR workflows do not receive repository secrets.

```yaml
name: Assign review
on:
  pull_request:
    types: [labeled, ready_for_review]
permissions: {}
jobs:
  assign:
    if: >-
      (github.event.action == 'labeled' && github.event.label.name == 'needs-review') ||
      (github.event.action == 'ready_for_review' && contains(github.event.pull_request.labels.*.name, 'needs-review'))
    runs-on: ubuntu-latest
    concurrency:
      group: ${{ github.workflow }}-${{ github.event.pull_request.number }}
      cancel-in-progress: false
    steps:
      - uses: actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349 # v2
        id: app-token
        with:
          app-id: ${{ vars.REVIEW_ASSIGNER_APP_ID }}
          private-key: ${{ secrets.REVIEW_ASSIGNER_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
          repositories: ${{ github.event.repository.name }}
          permission-pull-requests: write
          permission-contents: read
          permission-members: read
      - uses: lucaslim/review-assigner-action@f42e792245448a6dbcd52ff778e42f4fc18c4a11 # v2.0.0
        with:
          token: ${{ steps.app-token.outputs.token }}
```

## Development

Use Node 24 and Yarn 1.22.22. Run `yarn install --frozen-lockfile`, `yarn lint`, `yarn typecheck`, `yarn test`, and `yarn build`. Tests use fake Octokit calls and a local HTTP server with real Octokit pagination.

As in `lucaslim/pull-request-limiter-action`, `build/` is ignored on `main` and committed on a detached release commit. Release tags contain `build/index.js`; `main` is not a runnable action ref. `v2.1.0` is the fixed version and `v2` is the major-version ref. The `v1.0.0` and `v1` tags remain available for v1 consumers.
