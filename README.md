# Review assigner action

Adding `needs-review` to a non-draft PR requests review from the least-loaded eligible member of a GitHub team. The label stays on the PR. Remove and re-add it to request another person. Each label addition requests up to `count` new reviewers.

Load is the number of open PRs in this repository currently requesting that person's review. Equal loads use the least recent review request, then login. History covers at most the newest 300 repository issue events. A member with no request in that window sorts first.

The author, labeler, bots, excluded logins, current requested reviewers, and people who already submitted a review are ineligible. Draft PRs receive a comment explaining how to retry after they are ready. If nobody is eligible, the action comments and emits a warning.

## Inputs and output

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `token` | Yes | | GitHub App installation token. |
| `team` | Yes | | Team slug in the repository owner's organization. |
| `label` | No | `needs-review` | Label that triggers assignment. |
| `count` | No | `1` | Positive integer of reviewers to request. If fewer are eligible, all are requested. |
| `exclude` | No | | Comma or newline separated logins, matched without case sensitivity. |

The `reviewers` output contains comma-separated requested logins. It is empty when the event is ignored, the PR is a draft, or nobody is eligible. API errors and invalid inputs fail the run.

## Required app permissions

Install the GitHub App in the repository owner's organization with these permissions:

- Repository Pull requests, write.
- Repository Issues, write.
- Organization Members, read.

The installation token must retain all three permissions. `GITHUB_TOKEN` cannot read organization team membership. Eligible members also need access to the repository.

## Usage

Store the app ID in `REVIEW_ASSIGNER_APP_ID` and its private key in `REVIEW_ASSIGNER_PRIVATE_KEY`. Serialize runs per PR so repeated label events do not select from the same stale snapshot. Do not check out or execute PR code with the app token. Fork PR workflows do not receive repository secrets.

```yaml
name: Assign review
on:
  pull_request:
    types: [labeled]
permissions: {}
jobs:
  assign:
    if: github.event.label.name == 'needs-review'
    runs-on: ubuntu-latest
    concurrency:
      group: assign-review-${{ github.event.pull_request.number }}
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
          permission-issues: write
          permission-members: read
      - uses: lucaslim/review-assigner-action@7bfa4bdfa51977a33a9400c2452bc5ed6a5eab67 # v1.0.0
        with:
          token: ${{ steps.app-token.outputs.token }}
          team: retail-frontend-codeowners
```

## Development

Use Node 24 and Yarn 1.22.22. Run `yarn install --frozen-lockfile`, `yarn lint`, `yarn typecheck`, `yarn test`, and `yarn build`. Tests use fake Octokit calls and a local HTTP server with real Octokit pagination.

As in `lucaslim/pull-request-limiter-action`, `build/` is ignored on `main` and committed on a detached release commit. Release tags contain `build/index.js`; `main` is not a runnable action ref. `v1.0.0` is the fixed version and `v1` is the major-version ref.
