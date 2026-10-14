#!/usr/bin/env bash
# Prints the vX.Y.Z tag to release. Reads `git ls-remote --tags --refs` output on stdin.
# Usage: next-version.sh [requested-version]   (X.Y.Z, without the v prefix)
set -euo pipefail

requested="${1:-}"
semver='^[0-9]+\.[0-9]+\.[0-9]+$'

latest="$(sed 's#.*refs/tags/##' | { grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true; } | sed 's/^v//' | sort -V | tail -1)"
if [ -z "${latest}" ]; then
  echo "No vX.Y.Z release tag found on the remote." >&2
  exit 1
fi

if [ -z "${requested}" ]; then
  IFS=. read -r major minor patch <<<"${latest}"
  echo "v${major}.${minor}.$((patch + 1))"
  exit 0
fi

if ! printf '%s' "${requested}" | grep -Eq "${semver}"; then
  echo "Version must match X.Y.Z, got: ${requested}" >&2
  exit 1
fi
if [ "${requested}" != "${latest}" ] && [ "$(printf '%s\n%s\n' "${latest}" "${requested}" | sort -V | tail -1)" = "${requested}" ]; then
  echo "v${requested}"
else
  echo "Version ${requested} must be greater than the latest release v${latest}." >&2
  exit 1
fi
