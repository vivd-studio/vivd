#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REMOTE="origin"
CHECK_MODE="release"
ALLOW_DIRTY=false
DRY_RUN=false
TAG_INPUT=""
RUN_LOCAL_HOST_SMOKE=true
RUN_FLY_RELEASE_SMOKE=true

print_usage() {
  cat <<'EOF'
Usage: ./scripts/publish.sh [options] <version-or-tag>

Create and push a release tag only after local preflight checks pass.

Options:
  --check-mode <release|ci-local|none>
                         Validation preset to run before tagging.
                         release:  run the default publish preflight.
                         ci-local: run the broader existing local CI gate.
                         none:     skip checks entirely.
  --remote <name>        Git remote to push the tag to. Default: origin
  --allow-dirty          Allow tagging from a dirty worktree. Not recommended.
  --dry-run              Run checks and validations, but do not create or push the tag.
  --run-host-smoke       Force-enable the local Docker-provider host/browser smoke.
                         This is the default for release preflight.
  --skip-host-smoke      Skip the local Docker-provider host/browser smoke.
  --skip-fly-release-smoke
                         Skip the GitHub Fly release smoke job for this tag.
                         The tag is created as an annotated tag so CI can read
                         the publish metadata.
  -h, --help             Show this help.

Examples:
  ./scripts/publish.sh 1.1.10
  ./scripts/publish.sh v1.1.10
  ./scripts/publish.sh --check-mode ci-local 1.1.10
  ./scripts/publish.sh --skip-host-smoke 1.1.10
  ./scripts/publish.sh --skip-fly-release-smoke 1.1.10
  ./scripts/publish.sh --dry-run --allow-dirty 1.1.10
EOF
}

run_step() {
  local label="$1"
  shift
  echo
  echo "==> $label"
  "$@"
}

normalize_tag() {
  local raw="$1"
  if [[ "$raw" == v* ]]; then
    printf '%s\n' "$raw"
  else
    printf 'v%s\n' "$raw"
  fi
}

build_tag_message() {
  local tag="$1"
  cat <<EOF
Release $tag

publish.check_mode=${CHECK_MODE}
publish.run_host_smoke=${RUN_LOCAL_HOST_SMOKE}
publish.skip_fly_release_smoke=$([[ "${RUN_FLY_RELEASE_SMOKE}" == "true" ]] && printf 'false' || printf 'true')
EOF
}

ensure_valid_tag() {
  local tag="$1"
  if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
    echo "Tag '$tag' is not a supported semver-like release tag (expected v1.2.3 or v1.2.3-rc.1)." >&2
    exit 1
  fi
}

ensure_clean_worktree() {
  if [[ "$ALLOW_DIRTY" == "true" ]]; then
    return 0
  fi

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Refusing to publish from a dirty worktree. Commit or stash changes first, or rerun with --allow-dirty." >&2
    exit 1
  fi
}

ensure_remote_exists() {
  local remote="$1"
  git remote get-url "$remote" >/dev/null 2>&1 || {
    echo "Git remote '$remote' does not exist." >&2
    exit 1
  }
}

ensure_tag_absent() {
  local remote="$1"
  local tag="$2"

  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
    echo "Tag '$tag' already exists locally." >&2
    exit 1
  fi

  if git ls-remote --exit-code --tags "$remote" "refs/tags/$tag" >/dev/null 2>&1; then
    echo "Tag '$tag' already exists on remote '$remote'." >&2
    exit 1
  fi
}

run_release_preflight() {
  run_step "TypeScript typecheck" npm run typecheck
  run_step "Build shared" npm run build --workspace=@vivd/shared
  run_step "Build builder" npm run build --workspace=@vivd/builder
  run_step "Build backend" npm run build --workspace=@vivd/backend
  run_step "Build studio" npm run build --workspace=@vivd/studio
  run_step "Build scraper" npm run build --workspace=@vivd/scraper
  run_step \
    "Studio auth regression test" \
    npm run test:run --workspace=@vivd/studio -- server/http/studioAuth.test.ts
  run_step \
    "Backend Studio runtime regressions" \
    npm run test:run --workspace=@vivd/backend -- studio_api_router.test.ts trpc_context_org_procedure.test.ts fly_lifecycle.test.ts fly_provider_reconcile.test.ts fly_provider_orchestration.test.ts
  if [[ "$RUN_LOCAL_HOST_SMOKE" == "true" ]]; then
    run_step \
      "Build vivd-studio local host-smoke image" \
      docker build --file packages/studio/Dockerfile --target prod --tag vivd-studio:publish-host-smoke .
    run_step \
      "Install Playwright Chromium" \
      npx playwright install chromium
    run_step \
      "Studio Docker-provider host smoke" \
      env STUDIO_IMAGE=vivd-studio:publish-host-smoke VIVD_STUDIO_HOST_SMOKE_PORT=18080 npm run studio:host-smoke
  else
    echo
    echo "==> Local host/browser smoke skipped (--skip-host-smoke)"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-mode)
      if [[ $# -lt 2 ]]; then
        echo "--check-mode requires a value." >&2
        exit 1
      fi
      CHECK_MODE="$2"
      shift 2
      ;;
    --remote)
      if [[ $# -lt 2 ]]; then
        echo "--remote requires a value." >&2
        exit 1
      fi
      REMOTE="$2"
      shift 2
      ;;
    --allow-dirty)
      ALLOW_DIRTY=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --run-host-smoke)
      RUN_LOCAL_HOST_SMOKE=true
      shift
      ;;
    --skip-host-smoke)
      RUN_LOCAL_HOST_SMOKE=false
      shift
      ;;
    --skip-fly-release-smoke)
      RUN_FLY_RELEASE_SMOKE=false
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      print_usage
      exit 1
      ;;
    *)
      if [[ -n "$TAG_INPUT" ]]; then
        echo "Only one version/tag argument is supported." >&2
        print_usage
        exit 1
      fi
      TAG_INPUT="$1"
      shift
      ;;
  esac
done

if [[ -z "$TAG_INPUT" ]]; then
  echo "A version/tag argument is required." >&2
  print_usage
  exit 1
fi

case "$CHECK_MODE" in
  release|ci-local|none)
    ;;
  *)
    echo "Unsupported --check-mode '$CHECK_MODE'. Use release, ci-local, or none." >&2
    exit 1
    ;;
esac

TAG="$(normalize_tag "$TAG_INPUT")"

ensure_valid_tag "$TAG"
ensure_clean_worktree
ensure_remote_exists "$REMOTE"
ensure_tag_absent "$REMOTE" "$TAG"

case "$CHECK_MODE" in
  ci-local)
    run_step "Local CI preflight" npm run ci:local
    ;;
  release)
    run_release_preflight
    ;;
  none)
    echo "Skipping preflight checks (--check-mode=none)."
    ;;
esac

echo
echo "Ready to publish $TAG from $(git rev-parse --short HEAD)."
echo "Publish metadata:"
echo "  check_mode=$CHECK_MODE"
echo "  run_host_smoke=$RUN_LOCAL_HOST_SMOKE"
echo "  skip_fly_release_smoke=$([[ "$RUN_FLY_RELEASE_SMOKE" == "true" ]] && printf 'false' || printf 'true')"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run enabled. Skipping git tag creation and push."
  exit 0
fi

TAG_MESSAGE_FILE="$(mktemp)"
trap 'rm -f "$TAG_MESSAGE_FILE"' EXIT
build_tag_message "$TAG" >"$TAG_MESSAGE_FILE"

run_step "Create annotated tag $TAG" git tag -a "$TAG" -F "$TAG_MESSAGE_FILE"
run_step "Push tag $TAG to $REMOTE" git push "$REMOTE" "refs/tags/$TAG"

rm -f "$TAG_MESSAGE_FILE"
trap - EXIT

echo
echo "Published $TAG."
