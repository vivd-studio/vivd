#!/bin/sh
set -e

# Studio workspace directory (project files are hydrated here).
if [ -z "$VIVD_WORKSPACE_DIR" ]; then
  export VIVD_WORKSPACE_DIR="${WORKSPACE_DIR:-/home/studio/project}"
fi

# Keep OpenCode state project-scoped but separate from source files.
if [ -z "$VIVD_OPENCODE_DATA_HOME" ]; then
  export VIVD_OPENCODE_DATA_HOME="/home/studio/opencode-data"
fi
if [ -z "$XDG_DATA_HOME" ]; then
  export XDG_DATA_HOME="$VIVD_OPENCODE_DATA_HOME"
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

write_opencode_auth() {
  if [ -z "$GOOGLE_API_KEY" ]; then
    return 0
  fi

  echo "Setting up OpenCode authentication..."
  mkdir -p "${XDG_DATA_HOME}/opencode"

  cat <<EOF > "${XDG_DATA_HOME}/opencode/auth.json"
{
  "google": {
    "type": "api",
    "key": "${GOOGLE_API_KEY}"
  }
}
EOF
}

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

S3_SOURCE_URI=""
S3_OPENCODE_URI=""

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
  if [ -z "$S3_OPENCODE_URI" ]; then
    return 0
  fi

  sync_opencode_state
  sync_package_cache
}

sync_opencode_state() {
  if [ -z "$S3_OPENCODE_URI" ]; then
    return 0
  fi

  mkdir -p "${VIVD_OPENCODE_DATA_HOME}/opencode"
  aws_s3_sync "${VIVD_OPENCODE_DATA_HOME}/opencode" "${S3_OPENCODE_URI}/opencode" \
    --exclude "auth.json"
}

sync_package_cache() {
  if [ -z "$S3_OPENCODE_URI" ]; then
    return 0
  fi

  if [ "${VIVD_S3_SYNC_PACKAGE_CACHE:-1}" = "0" ]; then
    return 0
  fi

  mkdir -p "$VIVD_PACKAGE_CACHE_DIR"
  aws_s3_sync "$VIVD_PACKAGE_CACHE_DIR" "${S3_OPENCODE_URI}/package-cache"
}

sync_opencode_final() {
  sync_opencode_state

  if [ "${VIVD_S3_SHUTDOWN_SYNC_PACKAGE_CACHE:-0}" = "1" ]; then
    sync_package_cache
  fi
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
  if [ -z "$S3_OPENCODE_URI" ]; then
    return 0
  fi

  echo "Hydrating OpenCode data from S3..."
  echo "  Source: ${S3_OPENCODE_URI}"
  echo "  Target: ${VIVD_OPENCODE_DATA_HOME}"
  hydrate_opencode_state
  hydrate_package_cache
}

hydrate_opencode_state() {
  if [ -z "$S3_OPENCODE_URI" ]; then
    return 0
  fi

  mkdir -p "${VIVD_OPENCODE_DATA_HOME}/opencode"
  aws_s3_sync "${S3_OPENCODE_URI}/opencode" "${VIVD_OPENCODE_DATA_HOME}/opencode" \
    --exclude "auth.json"
}

hydrate_package_cache() {
  if [ -z "$S3_OPENCODE_URI" ]; then
    return 0
  fi

  if [ "${VIVD_S3_SYNC_PACKAGE_CACHE:-1}" = "0" ]; then
    return 0
  fi

  mkdir -p "$VIVD_PACKAGE_CACHE_DIR"
  aws_s3_sync "${S3_OPENCODE_URI}/package-cache" "$VIVD_PACKAGE_CACHE_DIR"
}

SYNC_ENABLED="0"
if { [ -n "$S3_SOURCE_URI" ] || [ -n "$S3_OPENCODE_URI" ]; } && command -v aws >/dev/null 2>&1; then
  SYNC_ENABLED="1"
fi

if [ "$SYNC_ENABLED" = "1" ]; then
  LEGACY_OPENCODE_DIR="${VIVD_WORKSPACE_DIR}/.vivd/opencode-data"
  if [ -d "$LEGACY_OPENCODE_DIR" ] && [ "$LEGACY_OPENCODE_DIR" != "$VIVD_OPENCODE_DATA_HOME" ] && [ ! -e "$VIVD_OPENCODE_DATA_HOME" ]; then
    mkdir -p "$(dirname "$VIVD_OPENCODE_DATA_HOME")"
    mv "$LEGACY_OPENCODE_DIR" "$VIVD_OPENCODE_DATA_HOME" || true
  fi

  PID=""
  STUB_PID=""
  HYDRATE_SOURCE_PID=""
  HYDRATE_OPENCODE_PID=""

  SYNC_INTERVAL="${VIVD_S3_SYNC_INTERVAL_SECONDS:-30}"

  on_term() {
    if [ -n "$PID" ]; then
      echo "Received shutdown signal. Stopping studio (pid=${PID})..."
      kill -TERM "$PID" 2>/dev/null || true
      SHUTDOWN_WAIT_SECONDS="${VIVD_SHUTDOWN_WAIT_SECONDS:-2}"
      case "$SHUTDOWN_WAIT_SECONDS" in
        ''|*[!0-9]*) SHUTDOWN_WAIT_SECONDS="2" ;;
      esac

      END_AT="$(( $(date +%s) + SHUTDOWN_WAIT_SECONDS ))"
      while kill -0 "$PID" 2>/dev/null && [ "$(date +%s)" -lt "$END_AT" ]; do
        sleep 0.2
      done

      if kill -0 "$PID" 2>/dev/null; then
        kill -KILL "$PID" 2>/dev/null || true
      fi

      wait "$PID" 2>/dev/null || true
    else
      echo "Received shutdown signal."
    fi

    if [ -n "$STUB_PID" ]; then
      kill -TERM "$STUB_PID" 2>/dev/null || true
      wait "$STUB_PID" 2>/dev/null || true
    fi

    if [ -n "$HYDRATE_SOURCE_PID" ]; then
      kill -TERM "$HYDRATE_SOURCE_PID" 2>/dev/null || true
      wait "$HYDRATE_SOURCE_PID" 2>/dev/null || true
    fi

    if [ -n "$HYDRATE_OPENCODE_PID" ]; then
      kill -TERM "$HYDRATE_OPENCODE_PID" 2>/dev/null || true
      wait "$HYDRATE_OPENCODE_PID" 2>/dev/null || true
    fi

    echo "Final sync to S3..."
    sync_source || true
    sync_opencode_final || true
    exit 0
  }

  trap on_term INT TERM

  # Fly Machines may probe the internal port while hydration is running. Keep a
  # lightweight HTTP listener on the expected port to avoid connection-refused
  # errors during cold starts. We'll replace it with the real studio server
  # once hydration has completed.
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

  if [ -n "$S3_SOURCE_URI" ]; then
    (hydrate_source) &
    HYDRATE_SOURCE_PID="$!"
  fi

  if [ -n "$S3_OPENCODE_URI" ]; then
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

  echo "Sync loop enabled (interval=${SYNC_INTERVAL}s)"
  case "$SYNC_INTERVAL" in
    ''|*[!0-9]*) SYNC_INTERVAL="30" ;;
  esac
  LAST_SYNC_AT="$(date +%s)"
  SYNC_DUE="0"
  while kill -0 "$PID" 2>/dev/null; do
    sleep 2
    SYNC_PAUSE_FILE="${VIVD_SYNC_PAUSE_FILE:-/tmp/vivd-sync.pause}"
    SYNC_PAUSE_MAX_AGE_SECONDS="${VIVD_SYNC_PAUSE_MAX_AGE_SECONDS:-600}"
    if [ -f "$SYNC_PAUSE_FILE" ]; then
      NOW="$(date +%s)"
      MTIME="$(stat -c %Y "$SYNC_PAUSE_FILE" 2>/dev/null || echo 0)"
      AGE="$((NOW - MTIME))"
      if [ "$AGE" -le "$SYNC_PAUSE_MAX_AGE_SECONDS" ]; then
        SYNC_DUE="1"
        continue
      fi
      rm -f "$SYNC_PAUSE_FILE" 2>/dev/null || true
    fi

    NOW="$(date +%s)"
    if [ "$SYNC_DUE" = "1" ] || [ "$((NOW - LAST_SYNC_AT))" -ge "$SYNC_INTERVAL" ]; then
      SYNC_DUE="0"
      LAST_SYNC_AT="$NOW"
      sync_source || true
      sync_opencode || true
    fi
  done

  wait "$PID"
  EXIT_CODE=$?
  echo "Final sync to S3..."
  sync_source || true
  sync_opencode_final || true
  exit "$EXIT_CODE"
fi

write_opencode_auth
exec "$@"
