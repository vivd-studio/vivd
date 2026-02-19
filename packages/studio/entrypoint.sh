#!/bin/sh
set -e

# Studio workspace directory (project files are hydrated here).
if [ -z "$VIVD_WORKSPACE_DIR" ]; then
  export VIVD_WORKSPACE_DIR="${WORKSPACE_DIR:-/home/studio/project}"
fi

# Keep OpenCode state in OpenCode's native data directory.
if [ -z "$VIVD_OPENCODE_DATA_HOME" ]; then
  DEFAULT_XDG_DATA_HOME="${XDG_DATA_HOME:-${HOME:-/root}/.local/share}"
  export VIVD_OPENCODE_DATA_HOME="${DEFAULT_XDG_DATA_HOME}/opencode"
fi

if [ -z "$VIVD_PACKAGE_CACHE_DIR" ]; then
  export VIVD_PACKAGE_CACHE_DIR="${VIVD_OPENCODE_DATA_HOME}/package-cache"
fi
mkdir -p "$VIVD_PACKAGE_CACHE_DIR"

if [ -z "$npm_config_cache" ]; then
  export npm_config_cache="${VIVD_PACKAGE_CACHE_DIR}/npm"
fi
if [ -z "$pnpm_config_store_dir" ]; then
  export pnpm_config_store_dir="${VIVD_PACKAGE_CACHE_DIR}/pnpm-store"
fi
if [ -z "$PNPM_STORE_PATH" ]; then
  export PNPM_STORE_PATH="$pnpm_config_store_dir"
fi
if [ -z "$YARN_CACHE_FOLDER" ]; then
  export YARN_CACHE_FOLDER="${VIVD_PACKAGE_CACHE_DIR}/yarn"
fi
mkdir -p "$npm_config_cache" "$pnpm_config_store_dir" "$YARN_CACHE_FOLDER"

configure_vertex_ai() {
  if [ -z "$GOOGLE_CLOUD_PROJECT" ]; then
    return 0
  fi

  if [ -z "$VERTEX_LOCATION" ]; then
    export VERTEX_LOCATION="global"
  fi

  if [ -z "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
    export GOOGLE_APPLICATION_CREDENTIALS="${VIVD_GOOGLE_APPLICATION_CREDENTIALS_PATH:-${HOME:-/root}/.config/gcloud/application_default_credentials.json}"
  fi

  if [ -n "$GOOGLE_APPLICATION_CREDENTIALS_JSON" ]; then
    mkdir -p "$(dirname "$GOOGLE_APPLICATION_CREDENTIALS")"
    (umask 077 && printf '%s' "$GOOGLE_APPLICATION_CREDENTIALS_JSON" > "$GOOGLE_APPLICATION_CREDENTIALS")
  fi

  if [ ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
    echo "Warning: Vertex AI enabled but credentials file not found at ${GOOGLE_APPLICATION_CREDENTIALS}" >&2
  fi
}

write_opencode_auth() {
  if [ -n "$GOOGLE_CLOUD_PROJECT" ]; then
    echo "Using Vertex AI authentication for OpenCode (project=${GOOGLE_CLOUD_PROJECT}, location=${VERTEX_LOCATION:-global})."
    return 0
  fi

  if [ -z "$GOOGLE_API_KEY" ]; then
    return 0
  fi

  echo "Setting up OpenCode authentication..."
  mkdir -p "${VIVD_OPENCODE_DATA_HOME}"

  cat <<EOF > "${VIVD_OPENCODE_DATA_HOME}/auth.json"
{
  "google": {
    "type": "api",
    "key": "${GOOGLE_API_KEY}"
  }
}
EOF
}

configure_vertex_ai

if [ -z "$AWS_EC2_METADATA_DISABLED" ]; then
  export AWS_EC2_METADATA_DISABLED=true
fi

# Cloudflare R2 convenience mapping (optional).
if [ -n "$R2_BUCKET" ] && [ -z "$VIVD_S3_BUCKET" ]; then
  export VIVD_S3_BUCKET="$R2_BUCKET"
fi
if [ -n "$R2_ENDPOINT" ] && [ -z "$VIVD_S3_ENDPOINT_URL" ]; then
  export VIVD_S3_ENDPOINT_URL="$R2_ENDPOINT"
fi
if [ -n "$R2_ACCESS_KEY" ] && [ -z "$AWS_ACCESS_KEY_ID" ]; then
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY"
fi
if [ -n "$R2_SECRET_KEY" ] && [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
  export AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY"
fi
if [ -n "$VIVD_S3_ENDPOINT_URL" ] && [ -z "$AWS_DEFAULT_REGION" ]; then
  # R2 uses "auto" as region for AWS-compatible tooling.
  export AWS_DEFAULT_REGION=auto
fi

aws_s3_sync() {
  SRC="$1"
  DST="$2"
  shift 2
  if [ -n "$VIVD_S3_ENDPOINT_URL" ]; then
    aws --endpoint-url "$VIVD_S3_ENDPOINT_URL" s3 sync "$SRC" "$DST" --only-show-errors "$@"
  else
    aws s3 sync "$SRC" "$DST" --only-show-errors "$@"
  fi
}

aws_s3_cp() {
  SRC="$1"
  DST="$2"
  if [ -n "$VIVD_S3_ENDPOINT_URL" ]; then
    aws --endpoint-url "$VIVD_S3_ENDPOINT_URL" s3 cp "$SRC" "$DST" --only-show-errors
  else
    aws s3 cp "$SRC" "$DST" --only-show-errors
  fi
}

aws_s3_rm() {
  TARGET_URI="$1"
  if [ -n "$VIVD_S3_ENDPOINT_URL" ]; then
    aws --endpoint-url "$VIVD_S3_ENDPOINT_URL" s3 rm "$TARGET_URI" --only-show-errors
  else
    aws s3 rm "$TARGET_URI" --only-show-errors
  fi
}

S3_SOURCE_URI=""
S3_OPENCODE_URI=""
S3_OPENCODE_STORAGE_URI=""

if [ -n "$VIVD_S3_SOURCE_URI" ]; then
  S3_SOURCE_URI="$VIVD_S3_SOURCE_URI"
elif [ -n "$VIVD_S3_BUCKET" ] && [ -n "$VIVD_PROJECT_SLUG" ]; then
  TENANT_ID="${VIVD_TENANT_ID:-default}"
  PROJECT_VERSION_SEGMENT=""
  if [ -n "$VIVD_PROJECT_VERSION" ]; then
    PROJECT_VERSION_SEGMENT="/v${VIVD_PROJECT_VERSION}"
  fi
  BASE_PREFIX="${VIVD_S3_PREFIX:-tenants/${TENANT_ID}/projects/${VIVD_PROJECT_SLUG}${PROJECT_VERSION_SEGMENT}}"
  S3_SOURCE_URI="s3://${VIVD_S3_BUCKET}/${BASE_PREFIX}/source"
fi

if [ -n "$VIVD_S3_OPENCODE_URI" ]; then
  S3_OPENCODE_URI="$VIVD_S3_OPENCODE_URI"
elif [ -n "$VIVD_S3_BUCKET" ] && [ -n "$VIVD_PROJECT_SLUG" ]; then
  TENANT_ID="${VIVD_TENANT_ID:-default}"
  OPENCODE_PREFIX="${VIVD_S3_OPENCODE_PREFIX:-tenants/${TENANT_ID}/projects/${VIVD_PROJECT_SLUG}/opencode}"
  S3_OPENCODE_URI="s3://${VIVD_S3_BUCKET}/${OPENCODE_PREFIX}"
fi

if [ -n "$VIVD_S3_OPENCODE_STORAGE_URI" ]; then
  S3_OPENCODE_STORAGE_URI="$VIVD_S3_OPENCODE_STORAGE_URI"
elif [ -n "$S3_OPENCODE_URI" ]; then
  S3_OPENCODE_STORAGE_URI="${S3_OPENCODE_URI}/storage"
fi

if [ -z "$S3_OPENCODE_URI" ] && [ -n "$S3_OPENCODE_STORAGE_URI" ]; then
  NORMALIZED_OPENCODE_STORAGE_URI="${S3_OPENCODE_STORAGE_URI%/}"
  if [ "${NORMALIZED_OPENCODE_STORAGE_URI##*/}" = "storage" ]; then
    S3_OPENCODE_URI="${NORMALIZED_OPENCODE_STORAGE_URI%/storage}"
  fi
fi

if [ -z "$S3_OPENCODE_STORAGE_URI" ] && [ -n "$S3_OPENCODE_URI" ]; then
  S3_OPENCODE_STORAGE_URI="${S3_OPENCODE_URI}/storage"
fi

sync_source() {
  if [ -z "$S3_SOURCE_URI" ]; then
    return 0
  fi

  aws_s3_sync "$VIVD_WORKSPACE_DIR" "$S3_SOURCE_URI" \
    --delete \
    --exclude "node_modules/*" \
    --exclude "dist/*" \
    --exclude ".astro/*" \
    --exclude ".vivd/opencode-data/*" \
    --exclude ".vivd/build.json" \
    --exclude ".git/index.lock"
}

sync_opencode() {
  if [ -z "$S3_OPENCODE_STORAGE_URI" ] && [ -z "$S3_OPENCODE_URI" ]; then
    return 0
  fi

  OPENCODE_SESSION_DIFF_DIR="${VIVD_OPENCODE_DATA_HOME}/storage/session_diff"
  OPENCODE_DB_PATH="${VIVD_OPENCODE_DATA_HOME}/opencode.db"
  OPENCODE_DB_SHM_PATH="${VIVD_OPENCODE_DATA_HOME}/opencode.db-shm"
  OPENCODE_DB_WAL_PATH="${VIVD_OPENCODE_DATA_HOME}/opencode.db-wal"

  if [ -n "$S3_OPENCODE_STORAGE_URI" ]; then
    mkdir -p "$OPENCODE_SESSION_DIFF_DIR"
    aws_s3_sync "$OPENCODE_SESSION_DIFF_DIR" "${S3_OPENCODE_STORAGE_URI}/session_diff" --delete
  fi

  if [ -n "$S3_OPENCODE_URI" ]; then
    if [ -f "$OPENCODE_DB_PATH" ]; then
      aws_s3_cp "$OPENCODE_DB_PATH" "${S3_OPENCODE_URI}/opencode.db"
    fi

    if [ -f "$OPENCODE_DB_SHM_PATH" ]; then
      aws_s3_cp "$OPENCODE_DB_SHM_PATH" "${S3_OPENCODE_URI}/opencode.db-shm"
    fi

    if [ -f "$OPENCODE_DB_WAL_PATH" ]; then
      aws_s3_cp "$OPENCODE_DB_WAL_PATH" "${S3_OPENCODE_URI}/opencode.db-wal"
    fi

    aws_s3_rm "${S3_OPENCODE_URI}/auth.json" || true
    aws_s3_rm "${S3_OPENCODE_URI}/opencode/auth.json" || true
  fi
}

run_sync_cycle() {
  REASON="$1"
  STARTED_AT="$(date +%s)"
  SOURCE_STATUS=0
  OPENCODE_STATUS=0

  (sync_source) &
  SOURCE_PID="$!"
  (sync_opencode) &
  OPENCODE_PID="$!"

  wait "$SOURCE_PID" || SOURCE_STATUS=$?
  wait "$OPENCODE_PID" || OPENCODE_STATUS=$?

  ENDED_AT="$(date +%s)"
  DURATION_SECONDS="$((ENDED_AT - STARTED_AT))"

  if [ "$SOURCE_STATUS" -ne 0 ]; then
    echo "Warning: ${REASON} source sync failed (exit=${SOURCE_STATUS})." >&2
  fi
  if [ "$OPENCODE_STATUS" -ne 0 ]; then
    echo "Warning: ${REASON} opencode sync failed (exit=${OPENCODE_STATUS})." >&2
  fi

  if [ "$DURATION_SECONDS" -gt "$SHUTDOWN_SYNC_BUDGET_SECONDS" ]; then
    echo "Warning: ${REASON} sync took ${DURATION_SECONDS}s, exceeding shutdown budget ${SHUTDOWN_SYNC_BUDGET_SECONDS}s." >&2
  fi
}

consume_sync_trigger() {
  if [ ! -f "$SYNC_TRIGGER_FILE" ]; then
    return 1
  fi
  rm -f "$SYNC_TRIGGER_FILE" 2>/dev/null || true
  return 0
}

hydrate_source() {
  if [ -z "$S3_SOURCE_URI" ]; then
    return 0
  fi

  echo "Hydrating source from S3..."
  echo "  Source: ${S3_SOURCE_URI}"
  echo "  Target: ${VIVD_WORKSPACE_DIR}"
  mkdir -p "$VIVD_WORKSPACE_DIR"
  aws_s3_sync "$S3_SOURCE_URI" "$VIVD_WORKSPACE_DIR" \
    --exclude "node_modules/*" \
    --exclude "dist/*" \
    --exclude ".astro/*" \
    --exclude ".vivd/opencode-data/*" \
    --exclude ".vivd/build.json" \
    --exclude ".git/index.lock"
}

hydrate_opencode() {
  if [ -z "$S3_OPENCODE_STORAGE_URI" ] && [ -z "$S3_OPENCODE_URI" ]; then
    return 0
  fi

  OPENCODE_SESSION_DIFF_DIR="${VIVD_OPENCODE_DATA_HOME}/storage/session_diff"
  SESSION_DIFF_PID=""
  DB_PID=""

  if [ -n "$S3_OPENCODE_STORAGE_URI" ]; then
    echo "Hydrating OpenCode session diffs from S3..."
    echo "  Source: ${S3_OPENCODE_STORAGE_URI}/session_diff"
    echo "  Target: ${OPENCODE_SESSION_DIFF_DIR}"
    mkdir -p "${OPENCODE_SESSION_DIFF_DIR}"
    (aws_s3_sync "${S3_OPENCODE_STORAGE_URI}/session_diff" "$OPENCODE_SESSION_DIFF_DIR" || true) &
    SESSION_DIFF_PID="$!"
  fi

  if [ -n "$S3_OPENCODE_URI" ]; then
    echo "Hydrating OpenCode DB from S3..."
    echo "  Source: ${S3_OPENCODE_URI}"
    echo "  Target: ${VIVD_OPENCODE_DATA_HOME}"
    mkdir -p "${VIVD_OPENCODE_DATA_HOME}"
    (
      aws_s3_cp "${S3_OPENCODE_URI}/opencode.db" "${VIVD_OPENCODE_DATA_HOME}/opencode.db" || true &
      aws_s3_cp "${S3_OPENCODE_URI}/opencode.db-shm" "${VIVD_OPENCODE_DATA_HOME}/opencode.db-shm" || true &
      aws_s3_cp "${S3_OPENCODE_URI}/opencode.db-wal" "${VIVD_OPENCODE_DATA_HOME}/opencode.db-wal" || true &
      wait
    ) &
    DB_PID="$!"
  fi

  if [ -n "$SESSION_DIFF_PID" ]; then
    wait "$SESSION_DIFF_PID" || true
  fi
  if [ -n "$DB_PID" ]; then
    wait "$DB_PID" || true
  fi
}

SYNC_ENABLED="0"
if { [ -n "$S3_SOURCE_URI" ] || [ -n "$S3_OPENCODE_STORAGE_URI" ] || [ -n "$S3_OPENCODE_URI" ]; } && command -v aws >/dev/null 2>&1; then
  SYNC_ENABLED="1"
fi

if [ "$SYNC_ENABLED" = "1" ]; then
  # Fly Machines may probe the internal port while hydration is running. Keep a
  # lightweight HTTP listener on the expected port to avoid connection-refused
  # errors during cold starts. We'll replace it with the real studio server
  # once hydration has completed.
  STUB_PID=""
  STUB_PORT="${PORT:-3100}"
  STUB_HOST="${STUDIO_HOST:-0.0.0.0}"

  if command -v node >/dev/null 2>&1; then
    STUB_PORT="$STUB_PORT" STUB_HOST="$STUB_HOST" node -e '
const http = require("http");
const port = Number.parseInt(process.env.STUB_PORT || "3100", 10);
const host = process.env.STUB_HOST || "0.0.0.0";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "starting" }));
    return;
  }
  res.statusCode = 503;
  res.setHeader("Content-Type", "text/plain");
  res.end("Studio is starting up. Please retry shortly.");
});

server.listen(port, host);
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
' >/dev/null 2>&1 &
    STUB_PID="$!"
  fi

  HYDRATE_SOURCE_PID=""
  HYDRATE_OPENCODE_PID=""

  if [ -n "$S3_SOURCE_URI" ]; then
    (hydrate_source) &
    HYDRATE_SOURCE_PID="$!"
  fi

  if [ -n "$S3_OPENCODE_STORAGE_URI" ] || [ -n "$S3_OPENCODE_URI" ]; then
    (hydrate_opencode) &
    HYDRATE_OPENCODE_PID="$!"
  fi

  if [ -n "$HYDRATE_SOURCE_PID" ]; then
    wait "$HYDRATE_SOURCE_PID" || true
  fi

  if [ -n "$HYDRATE_OPENCODE_PID" ]; then
    wait "$HYDRATE_OPENCODE_PID" || true
  fi

  if [ -n "$STUB_PID" ]; then
    kill -TERM "$STUB_PID" 2>/dev/null || true
    wait "$STUB_PID" 2>/dev/null || true
  fi

  write_opencode_auth

  echo "Starting studio..."
  "$@" &
  PID=$!

  SYNC_TRIGGER_FILE="${VIVD_SYNC_TRIGGER_FILE:-/tmp/vivd-sync.trigger}"
  SHUTDOWN_SYNC_BUDGET_SECONDS="${VIVD_SHUTDOWN_SYNC_BUDGET_SECONDS:-25}"
  SHUTDOWN_CHILD_WAIT_SECONDS="${VIVD_SHUTDOWN_CHILD_WAIT_SECONDS:-20}"
  case "$SHUTDOWN_SYNC_BUDGET_SECONDS" in
    ''|*[!0-9]*) SHUTDOWN_SYNC_BUDGET_SECONDS="25" ;;
  esac
  if [ "$SHUTDOWN_SYNC_BUDGET_SECONDS" -le 0 ]; then
    SHUTDOWN_SYNC_BUDGET_SECONDS="25"
  fi
  case "$SHUTDOWN_CHILD_WAIT_SECONDS" in
    ''|*[!0-9]*) SHUTDOWN_CHILD_WAIT_SECONDS="20" ;;
  esac
  if [ "$SHUTDOWN_CHILD_WAIT_SECONDS" -le 0 ]; then
    SHUTDOWN_CHILD_WAIT_SECONDS="20"
  fi
  TERMINATING="0"

  on_term() {
    if [ "$TERMINATING" = "1" ]; then
      return
    fi
    TERMINATING="1"

    echo "Received shutdown signal. Stopping studio (pid=${PID})..."
    kill -TERM "$PID" 2>/dev/null || true
    WAITED="0"
    while kill -0 "$PID" 2>/dev/null; do
      if [ "$WAITED" -ge "$SHUTDOWN_CHILD_WAIT_SECONDS" ]; then
        echo "Studio did not stop within ${SHUTDOWN_CHILD_WAIT_SECONDS}s; forcing SIGKILL..."
        kill -KILL "$PID" 2>/dev/null || true
        break
      fi
      sleep 1
      WAITED="$((WAITED + 1))"
    done
    wait "$PID" 2>/dev/null || true

    echo "Final sync to S3..."
    run_sync_cycle "shutdown"
    exit 0
  }

  trap on_term INT TERM

  echo "Sync loop enabled (trigger_file=${SYNC_TRIGGER_FILE})"
  while kill -0 "$PID" 2>/dev/null; do
    sleep 1
    SYNC_PAUSE_FILE="${VIVD_SYNC_PAUSE_FILE:-/tmp/vivd-sync.pause}"
    SYNC_PAUSE_MAX_AGE_SECONDS="${VIVD_SYNC_PAUSE_MAX_AGE_SECONDS:-600}"
    if [ -f "$SYNC_PAUSE_FILE" ]; then
      NOW="$(date +%s)"
      MTIME="$(stat -c %Y "$SYNC_PAUSE_FILE" 2>/dev/null || echo 0)"
      AGE="$((NOW - MTIME))"
      if [ "$AGE" -le "$SYNC_PAUSE_MAX_AGE_SECONDS" ]; then
        continue
      fi
      rm -f "$SYNC_PAUSE_FILE" 2>/dev/null || true
    fi

    if consume_sync_trigger; then
      run_sync_cycle "trigger"
    fi
  done

  wait "$PID"
  EXIT_CODE=$?
  echo "Final sync to S3..."
  run_sync_cycle "final-exit"
  exit "$EXIT_CODE"
fi

write_opencode_auth
exec "$@"
