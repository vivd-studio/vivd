#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Delete GHCR container image versions that have tags matching a prefix (default: dev-).

Usage:
  ./scripts/delete-ghcr-dev-images.sh [--repo ghcr.io/OWNER/PACKAGE] [--prefix dev-] [--apply] [--yes]

Options:
  --repo    GHCR image repository (default: ghcr.io/vivd-studio/vivd-studio)
  --prefix  Tag prefix to match (default: dev-)
  --apply   Actually delete matching versions (default is dry-run)
  --yes     Skip interactive confirmation
  --help    Show this help

Notes:
  - Requires: gh CLI + jq
  - Auth must have package delete permissions (e.g. delete:packages)
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

IMAGE_REPO="ghcr.io/vivd-studio/vivd-studio"
TAG_PREFIX="dev-"
APPLY=0
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      IMAGE_REPO="${2:-}"
      shift 2
      ;;
    --prefix)
      TAG_PREFIX="${2:-}"
      shift 2
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    --yes)
      ASSUME_YES=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_cmd gh
require_cmd jq

if [[ -z "$TAG_PREFIX" ]]; then
  echo "--prefix must not be empty" >&2
  exit 1
fi

owner_repo="${IMAGE_REPO#ghcr.io/}"
if [[ "$owner_repo" == "$IMAGE_REPO" ]]; then
  echo "Expected --repo in form ghcr.io/OWNER/PACKAGE (got: $IMAGE_REPO)" >&2
  exit 1
fi

IFS='/' read -r owner package extra <<<"$owner_repo"
if [[ -z "${owner:-}" || -z "${package:-}" || -n "${extra:-}" ]]; then
  echo "Expected --repo in form ghcr.io/OWNER/PACKAGE (got: $IMAGE_REPO)" >&2
  exit 1
fi

if gh api "orgs/${owner}" >/dev/null 2>&1; then
  base_path="orgs/${owner}/packages/container/${package}/versions"
  owner_kind="org"
else
  base_path="users/${owner}/packages/container/${package}/versions"
  owner_kind="user"
fi

all_versions_json='[]'
page=1
while true; do
  page_json="$(gh api "${base_path}?per_page=100&page=${page}")"
  count="$(jq 'length' <<<"$page_json")"
  if [[ "$count" -eq 0 ]]; then
    break
  fi
  all_versions_json="$(jq -c --argjson existing "$all_versions_json" --argjson page "$page_json" '$existing + $page')"
  page=$((page + 1))
done

matches_json="$(jq -c --arg prefix "$TAG_PREFIX" '
  [
    .[]
    | . as $version
    | ($version.metadata.container.tags // []) as $tags
    | ($tags | map(select(startswith($prefix)))) as $matched
    | select(($matched | length) > 0)
    | {
        id: $version.id,
        tags: $tags,
        matchedTags: $matched,
        updatedAt: ($version.updated_at // "unknown")
      }
  ]
' <<<"$all_versions_json")"

match_count="$(jq 'length' <<<"$matches_json")"
echo "Repository: ${IMAGE_REPO}"
echo "Owner type: ${owner_kind}"
echo "Tag prefix: ${TAG_PREFIX}"
echo "Matches: ${match_count}"

if [[ "$match_count" -eq 0 ]]; then
  echo "No matching versions found."
  exit 0
fi

echo
echo "Matching versions:"
jq -r '.[] | "- id=\(.id) matched=\(.matchedTags | join(",")) tags=\(.tags | join(",")) updated=\(.updatedAt)"' <<<"$matches_json"

if [[ "$APPLY" -ne 1 ]]; then
  echo
  echo "Dry-run only. Re-run with --apply to delete."
  exit 0
fi

if [[ "$ASSUME_YES" -ne 1 ]]; then
  echo
  read -r -p "Delete ${match_count} matching version(s) from ${IMAGE_REPO}? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo
echo "Deleting..."
deleted=0
while IFS= read -r version_id; do
  gh api -X DELETE "${base_path}/${version_id}" >/dev/null
  deleted=$((deleted + 1))
  echo "Deleted version id=${version_id} (${deleted}/${match_count})"
done < <(jq -r '.[].id' <<<"$matches_json")

echo
echo "Done. Deleted ${deleted} version(s)."
