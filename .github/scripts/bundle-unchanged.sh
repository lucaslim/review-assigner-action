#!/usr/bin/env bash
# Exits 0 when build/ and action.yml match those shipped in the given release tag.
# Usage: bundle-unchanged.sh <release-tag>   (run from the repo root after `yarn build`)
set -euo pipefail

tag="$1"
prev="$(mktemp -d)"
trap 'rm -rf "${prev}"' EXIT

git archive "${tag}" build/ action.yml | tar -x -C "${prev}"
diff -r "${prev}/build" build >/dev/null && diff "${prev}/action.yml" action.yml >/dev/null
