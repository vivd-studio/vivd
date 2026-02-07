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
    --exclude "node_modules/*" \
    --exclude ".vivd/opencode-data/*"
}

sync_opencode() {
  if [ -z "$S3_OPENCODE_URI" ]; then
    return 0
  fi

  mkdir -p "$VIVD_OPENCODE_DATA_HOME"
  aws_s3_sync "$VIVD_OPENCODE_DATA_HOME" "$S3_OPENCODE_URI"
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

  if [ -n "$S3_SOURCE_URI" ]; then
    echo "Hydrating source from S3..."
    echo "  Source: ${S3_SOURCE_URI}"
    echo "  Target: ${VIVD_WORKSPACE_DIR}"
    mkdir -p "$VIVD_WORKSPACE_DIR"
    aws_s3_sync "$S3_SOURCE_URI" "$VIVD_WORKSPACE_DIR" \
      --exclude "node_modules/*" \
      --exclude ".vivd/opencode-data/*" || true
  fi

  if [ -n "$S3_OPENCODE_URI" ]; then
    echo "Hydrating OpenCode data from S3..."
    echo "  Source: ${S3_OPENCODE_URI}"
    echo "  Target: ${VIVD_OPENCODE_DATA_HOME}"
    mkdir -p "$VIVD_OPENCODE_DATA_HOME"
    aws_s3_sync "$S3_OPENCODE_URI" "$VIVD_OPENCODE_DATA_HOME" || true
  fi

  write_opencode_auth

  echo "Starting studio..."
  "$@" &
  PID=$!

  SYNC_INTERVAL="${VIVD_S3_SYNC_INTERVAL_SECONDS:-30}"

  on_term() {
    echo "Received shutdown signal. Stopping studio (pid=${PID})..."
    kill -TERM "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true

    echo "Final sync to S3..."
    sync_source || true
    sync_opencode || true
    exit 0
  }

  trap on_term INT TERM

  echo "Sync loop enabled (interval=${SYNC_INTERVAL}s)"
  while kill -0 "$PID" 2>/dev/null; do
    sleep "$SYNC_INTERVAL"
    sync_source || true
    sync_opencode || true
  done

  wait "$PID"
  EXIT_CODE=$?
  echo "Final sync to S3..."
  sync_source || true
  sync_opencode || true
  exit "$EXIT_CODE"
fi

write_opencode_auth
exec "$@"
