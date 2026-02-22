#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_BUILD=false
RUN_LINT=true
RUN_DB_INTEGRATION=false
RUN_BUCKET_INTEGRATION=false
RUN_FLY_INTEGRATION=false
ALLOW_KNOWN_FLY_REHYDRATE_FAILURE="${VIVD_ALLOW_KNOWN_FLY_REHYDRATE_FAIL:-0}"
KNOWN_FLY_REHYDRATE_FAILURE_PATTERN="Fly OpenCode rehydrate + revert > persists agent edit across rehydrate and reverts it afterwards"

print_usage() {
  cat <<'EOF'
Usage: ./scripts/ci-local.sh [options]

Options:
  --build                Run package builds after tests.
  --skip-lint            Skip frontend lint step.
  --db-integration       Run DB-backed backend integration tests.
  --bucket-integration   Run object-storage integration tests for studio artifact sync.
  --fly-integration      Run Fly integration tests (machine lifecycle + OpenCode rehydrate/revert).
  --allow-known-fly-rehydrate-failure
                         Allow the known failing Fly rehydrate/revert integration test
                         to fail without failing the full local CI run.
  -h, --help             Show this help.

Examples:
  ./scripts/ci-local.sh
  ./scripts/ci-local.sh --build --db-integration --bucket-integration
  ./scripts/ci-local.sh --db-integration --bucket-integration --fly-integration
  ./scripts/ci-local.sh --db-integration --bucket-integration --fly-integration --allow-known-fly-rehydrate-failure
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build)
      RUN_BUILD=true
      shift
      ;;
    --skip-lint)
      RUN_LINT=false
      shift
      ;;
    --db-integration)
      RUN_DB_INTEGRATION=true
      shift
      ;;
    --bucket-integration)
      RUN_BUCKET_INTEGRATION=true
      shift
      ;;
    --fly-integration)
      RUN_FLY_INTEGRATION=true
      shift
      ;;
    --allow-known-fly-rehydrate-failure)
      ALLOW_KNOWN_FLY_REHYDRATE_FAILURE=1
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_usage
      exit 1
      ;;
  esac
done

load_env_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$file"; set +a
  fi
}

# Load local envs for commands that do not auto-load dotenv files (e.g. studio tests).
load_env_file "$ROOT_DIR/.env"
load_env_file "$ROOT_DIR/.env.local"
load_env_file "$ROOT_DIR/packages/backend/.env"
load_env_file "$ROOT_DIR/packages/backend/.env.local"

run_step() {
  local label="$1"
  shift
  echo
  echo "==> $label"
  "$@"
}

run_step_allow_known_failure() {
  local label="$1"
  local expected_pattern="$2"
  shift 2

  echo
  echo "==> $label"

  local log_file
  log_file="$(mktemp)"

  set +e
  "$@" 2>&1 | tee "$log_file"
  local status=${PIPESTATUS[0]}
  set -e

  if [[ $status -eq 0 ]]; then
    rm -f "$log_file"
    echo "[ci-local] Known-failure mode enabled, but step passed."
    return 0
  fi

  if grep -Fq "$expected_pattern" "$log_file"; then
    rm -f "$log_file"
    echo "[ci-local] Allowing known Fly rehydrate/revert failure."
    return 0
  fi

  rm -f "$log_file"
  echo "[ci-local] Step failed and did not match known-failure signature." >&2
  return $status
}

if [[ "$RUN_LINT" == "true" ]]; then
  run_step "Frontend lint" npm run lint
fi
run_step "Unit tests (backend/frontend/scraper)" npm run test:run
run_step "Studio tests" npm run test:run --workspace=@vivd/studio

if [[ "$RUN_DB_INTEGRATION" == "true" ]]; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is required for --db-integration" >&2
    exit 1
  fi
  export VIVD_RUN_DB_INTEGRATION_TESTS=1
  run_step \
    "Backend DB integration tests" \
    npm run test:integration --workspace=@vivd/backend -- test/integration/db_usage_plugin_services.test.ts
fi

if [[ "$RUN_BUCKET_INTEGRATION" == "true" ]]; then
  if [[ -z "${VIVD_S3_BUCKET:-${R2_BUCKET:-}}" ]]; then
    echo "VIVD_S3_BUCKET or R2_BUCKET is required for --bucket-integration" >&2
    exit 1
  fi
  export VIVD_RUN_ARTIFACT_SYNC_BUCKET_TESTS=1
  run_step \
    "Studio bucket integration tests" \
    npm run test:run --workspace=@vivd/studio -- server/services/sync/ArtifactSyncService.integration.test.ts
fi

if [[ "$RUN_FLY_INTEGRATION" == "true" ]]; then
  if [[ -z "${FLY_API_TOKEN:-}" || -z "${FLY_STUDIO_APP:-}" ]]; then
    echo "FLY_API_TOKEN and FLY_STUDIO_APP are required for --fly-integration" >&2
    exit 1
  fi

  export VIVD_RUN_STUDIO_BUCKET_SYNC_TESTS=1
  run_step \
    "Fly machine + bucket sync integration tests" \
    npm run test:integration --workspace=@vivd/backend -- test/integration/fly_shutdown_bucket_sync.test.ts

  run_step \
    "Fly warm reconcile integration tests" \
    npm run test:integration --workspace=@vivd/backend -- test/integration/fly_reconcile_flow.test.ts

  export VIVD_RUN_OPENCODE_REHYDRATE_REVERT_TESTS=1
  if [[ "$ALLOW_KNOWN_FLY_REHYDRATE_FAILURE" == "1" ]]; then
    run_step_allow_known_failure \
      "Fly OpenCode rehydrate/revert integration tests (known failure allowed)" \
      "$KNOWN_FLY_REHYDRATE_FAILURE_PATTERN" \
      npm run test:integration --workspace=@vivd/backend -- test/integration/fly_opencode_rehydrate_revert.test.ts
  else
    run_step \
      "Fly OpenCode rehydrate/revert integration tests" \
      npm run test:integration --workspace=@vivd/backend -- test/integration/fly_opencode_rehydrate_revert.test.ts
  fi
fi

if [[ "$RUN_BUILD" == "true" ]]; then
  run_step "Build shared" npm run build --workspace=@vivd/shared
  run_step "Build backend" npm run build --workspace=@vivd/backend
  run_step "Build frontend" npm run build --workspace=@vivd/frontend
  run_step "Build scraper" npm run build --workspace=@vivd/scraper
  run_step "Build studio" npm run build --workspace=@vivd/studio
fi

echo
echo "Local CI run completed successfully."
