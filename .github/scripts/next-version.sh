#!/usr/bin/env bash
# Prints the vX.Y.Z tag to release. Without a requested version, the bump comes from the
# conventional-commit titles since the latest vX.Y.Z tag: `!` or BREAKING CHANGE is major,
# `feat` is minor, anything else is patch.
# Usage: next-version.sh [requested-version]   (X.Y.Z, without the v prefix)
set -euo pipefail

requested="${1:-}"
semver='^[0-9]+\.[0-9]+\.[0-9]+$'

latest="$(git tag --list 'v*' | { grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true; } | sed 's/^v//' | sort -V | tail -1)"
if [ -z "${latest}" ]; then
  echo "No vX.Y.Z release tag found." >&2
  exit 1
fi

if [ -z "${requested}" ]; then
  if [ -z "$(git rev-list "v${latest}..HEAD")" ]; then
    echo "No commits since v${latest}." >&2
    exit 1
  fi
  log="$(git log --format='%s%n%b' "v${latest}..HEAD")"
  IFS=. read -r major minor patch <<<"${latest}"
  if grep -qE '^[a-z]+(\([^)]*\))?!:|^BREAKING[ -]CHANGE:' <<<"${log}"; then
    echo "v$((major + 1)).0.0"
  elif grep -qE '^feat(\([^)]*\))?:' <<<"${log}"; then
    echo "v${major}.$((minor + 1)).0"
  else
    echo "v${major}.${minor}.$((patch + 1))"
  fi
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
