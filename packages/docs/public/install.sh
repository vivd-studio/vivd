#!/usr/bin/env bash
set -euo pipefail

DEFAULT_INSTALLER_BASE_URL="https://docs.vivd.studio/install"
INSTALLER_BASE_URL="${VIVD_INSTALLER_BASE_URL:-$DEFAULT_INSTALLER_BASE_URL}"
INSTALL_DIR="${VIVD_INSTALL_DIR:-$HOME/vivd}"
PRIMARY_HOST_INPUT="${VIVD_DOMAIN:-}"
OPENROUTER_API_KEY_INPUT="${OPENROUTER_API_KEY:-}"
SINGLE_PROJECT_MODE_INPUT="${VIVD_SINGLE_PROJECT_MODE:-false}"
SELFHOST_IMAGE_TAG_INPUT="${VIVD_SELFHOST_IMAGE_TAG:-}"
TLS_MODE_INPUT="${VIVD_TLS_MODE:-auto}"
ACME_EMAIL_INPUT="${VIVD_ACME_EMAIL:-}"
AUTO_START="true"

usage() {
  cat <<'EOF'
Vivd solo self-host installer

Usage:
  curl -fsSL https://docs.vivd.studio/install.sh | bash

Optional flags:
  --install-dir <path>       Target directory (default: ~/vivd)
  --domain <host>            Primary host or origin, e.g. example.com
  --openrouter-api-key <key> OpenRouter API key
  --single-project <bool>    true or false (default: false)
  --image-tag <tag>          Self-host image tag (default: latest or latest-arm64)
  --tls-mode <mode>          auto, managed, or external (default: auto)
  --acme-email <email>       Email used for managed HTTPS certificates
  --no-start                 Write files but do not start Docker Compose
  --help                     Show this message

Environment overrides:
  VIVD_INSTALLER_BASE_URL
  VIVD_INSTALL_DIR
  VIVD_DOMAIN
  OPENROUTER_API_KEY
  VIVD_SINGLE_PROJECT_MODE
  VIVD_SELFHOST_IMAGE_TAG
  VIVD_TLS_MODE
  VIVD_ACME_EMAIL
EOF
}

log() {
  printf '[vivd-install] %s\n' "$*"
}

fail() {
  printf '[vivd-install] ERROR: %s\n' "$*" >&2
  exit 1
}

supports_terminal_links() {
  [ -t 1 ] || return 1
  case "${TERM_PROGRAM:-}" in
    iTerm.app|Apple_Terminal|WezTerm|vscode)
      return 0
      ;;
  esac
  [ -n "${VTE_VERSION:-}" ] && return 0
  [ -n "${WT_SESSION:-}" ] && return 0
  [ -n "${KONSOLE_VERSION:-}" ] && return 0
  return 1
}

format_terminal_link() {
  local url="$1"
  local label="${2:-$1}"
  if supports_terminal_links; then
    printf '\033]8;;%s\033\\%s\033]8;;\033\\' "$url" "$label"
  else
    printf '%s' "$label"
  fi
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

is_local_host() {
  case "$1" in
    localhost|127.0.0.1|0.0.0.0|*.localhost|*.local|*.nip.io)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_ip_host() {
  local host="$1"
  if printf '%s' "$host" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    return 0
  fi
  case "$host" in
    *:*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

normalize_host() {
  local raw="$1"
  raw="${raw#http://}"
  raw="${raw#https://}"
  raw="${raw%%/*}"
  raw="${raw%%\?*}"
  raw="${raw%%#*}"
  printf '%s' "${raw%/}"
}

is_public_hostname() {
  local host="$1"
  ! is_local_host "$host" && ! is_ip_host "$host"
}

resolve_tls_mode() {
  local requested
  requested="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  local host="$2"

  case "$requested" in
    auto)
      if is_public_hostname "$host"; then
        printf 'managed'
      else
        printf 'off'
      fi
      ;;
    managed)
      is_public_hostname "$host" || fail "Managed TLS requires a public DNS hostname, not localhost or a raw IP"
      printf 'managed'
      ;;
    external)
      printf 'off'
      ;;
    *)
      fail "Expected --tls-mode to be auto, managed, or external"
      ;;
  esac
}

resolve_primary_origin() {
  local host="$1"
  local tls_mode="$2"
  local requested_tls_mode="$3"

  if [ "$tls_mode" = "managed" ] && is_public_hostname "$host"; then
    printf 'https://%s' "$host"
    return
  fi

  if [ "$requested_tls_mode" = "external" ] && is_public_hostname "$host"; then
    printf 'https://%s' "$host"
    return
  fi

  printf 'http://%s' "$host"
}

validate_email() {
  case "$1" in
    *@*.*)
      return 0
      ;;
    *)
      fail "Expected a valid email address"
      ;;
  esac
}

prompt_hint_for_var() {
  case "$1" in
    PRIMARY_HOST_INPUT)
      printf '%s' "--domain or VIVD_DOMAIN"
      ;;
    OPENROUTER_API_KEY_INPUT)
      printf '%s' "--openrouter-api-key or OPENROUTER_API_KEY"
      ;;
    ACME_EMAIL_INPUT)
      printf '%s' "--acme-email or VIVD_ACME_EMAIL"
      ;;
    *)
      printf '%s' "the matching flag or environment variable"
      ;;
  esac
}

resolve_prompt_input() {
  if (: </dev/tty) 2>/dev/null; then
    printf '%s' "/dev/tty"
    return 0
  fi

  if [ -t 0 ]; then
    printf '%s' "/dev/stdin"
    return 0
  fi

  return 1
}

prompt_if_empty() {
  local var_name="$1"
  local prompt="$2"
  local secret="${3:-false}"
  local current_value
  local prompt_input
  local input_hint
  current_value="${!var_name:-}"
  if [ -n "$current_value" ]; then
    return
  fi

  if ! prompt_input="$(resolve_prompt_input)"; then
    input_hint="$(prompt_hint_for_var "$var_name")"
    fail "$prompt is required; re-run interactively or pass $input_hint"
  fi

  if [ "$secret" = "true" ]; then
    printf '%s: ' "$prompt" >&2
    if stty -echo <"$prompt_input" 2>/dev/null; then
      IFS= read -r current_value <"$prompt_input" || true
      stty echo <"$prompt_input" 2>/dev/null || true
    else
      IFS= read -r current_value <"$prompt_input" || true
    fi
    printf '\n' >&2
  else
    printf '%s: ' "$prompt" >&2
    IFS= read -r current_value <"$prompt_input" || true
  fi

  if [ -z "$current_value" ]; then
    input_hint="$(prompt_hint_for_var "$var_name")"
    fail "$prompt is required; re-run interactively or pass $input_hint"
  fi
  printf -v "$var_name" '%s' "$current_value"
}

normalize_bool() {
  local raw
  raw="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    1|true|yes|y|on)
      printf 'true'
      ;;
    0|false|no|n|off)
      printf 'false'
      ;;
    *)
      fail "Expected boolean value, got: $1"
      ;;
  esac
}

generate_secret() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

resolve_default_selfhost_image_tag() {
  local arch
  arch="$(uname -m | tr '[:upper:]' '[:lower:]')"
  case "$arch" in
    arm64|aarch64)
      printf 'latest-arm64'
      ;;
    *)
      printf 'latest'
      ;;
  esac
}

download_file() {
  local url="$1"
  local output_path="$2"
  curl -fsSL "$url" -o "$output_path"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-dir)
      [ "$#" -ge 2 ] || fail "--install-dir requires a value"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --domain)
      [ "$#" -ge 2 ] || fail "--domain requires a value"
      PRIMARY_HOST_INPUT="$2"
      shift 2
      ;;
    --openrouter-api-key)
      [ "$#" -ge 2 ] || fail "--openrouter-api-key requires a value"
      OPENROUTER_API_KEY_INPUT="$2"
      shift 2
      ;;
    --single-project)
      [ "$#" -ge 2 ] || fail "--single-project requires a value"
      SINGLE_PROJECT_MODE_INPUT="$2"
      shift 2
      ;;
    --image-tag)
      [ "$#" -ge 2 ] || fail "--image-tag requires a value"
      SELFHOST_IMAGE_TAG_INPUT="$2"
      shift 2
      ;;
    --tls-mode)
      [ "$#" -ge 2 ] || fail "--tls-mode requires a value"
      TLS_MODE_INPUT="$2"
      shift 2
      ;;
    --acme-email)
      [ "$#" -ge 2 ] || fail "--acme-email requires a value"
      ACME_EMAIL_INPUT="$2"
      shift 2
      ;;
    --no-start)
      AUTO_START="false"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

require_command curl
require_command docker
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable"

prompt_if_empty PRIMARY_HOST_INPUT "Primary host or IP for this Vivd install"
prompt_if_empty OPENROUTER_API_KEY_INPUT "OpenRouter API key" true

SINGLE_PROJECT_MODE_INPUT="$(normalize_bool "$SINGLE_PROJECT_MODE_INPUT")"
if [ -z "$SELFHOST_IMAGE_TAG_INPUT" ]; then
  SELFHOST_IMAGE_TAG_INPUT="$(resolve_default_selfhost_image_tag)"
fi

PRIMARY_HOST="$(normalize_host "$PRIMARY_HOST_INPUT")"
[ -n "$PRIMARY_HOST" ] || fail "Could not parse a primary host from: $PRIMARY_HOST_INPUT"

REQUESTED_TLS_MODE="$(printf '%s' "$TLS_MODE_INPUT" | tr '[:upper:]' '[:lower:]')"
RESOLVED_TLS_MODE="$(resolve_tls_mode "$TLS_MODE_INPUT" "$PRIMARY_HOST")"
if [ "$RESOLVED_TLS_MODE" = "managed" ]; then
  prompt_if_empty ACME_EMAIL_INPUT "Email for HTTPS certificate renewal notices"
  validate_email "$ACME_EMAIL_INPUT"
  CADDY_ASSET="Caddyfile"
else
  CADDY_ASSET="Caddyfile.plain-http"
fi

PRIMARY_ORIGIN="$(resolve_primary_origin "$PRIMARY_HOST" "$RESOLVED_TLS_MODE" "$REQUESTED_TLS_MODE")"
if [ "$REQUESTED_TLS_MODE" = "external" ]; then
  TLS_MODE_NOTE="external"
else
  TLS_MODE_NOTE="$RESOLVED_TLS_MODE"
fi
BETTER_AUTH_SECRET_VALUE="$(generate_secret)"
SCRAPER_API_KEY_VALUE="$(generate_secret)"
POSTGRES_PASSWORD_VALUE="$(generate_secret)"
LOCAL_S3_ACCESS_KEY_VALUE="vivd$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
LOCAL_S3_SECRET_KEY_VALUE="$(generate_secret)"
LOCAL_S3_BUCKET_VALUE="vivd"

mkdir -p "$INSTALL_DIR"

for target in docker-compose.yml Caddyfile .env; do
  if [ -e "$INSTALL_DIR/$target" ]; then
    fail "Refusing to overwrite existing $INSTALL_DIR/$target"
  fi
done

log "Downloading solo self-host bundle from $INSTALLER_BASE_URL"
download_file "$INSTALLER_BASE_URL/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
download_file "$INSTALLER_BASE_URL/$CADDY_ASSET" "$INSTALL_DIR/Caddyfile"
log "Using self-host image tag $SELFHOST_IMAGE_TAG_INPUT"

cat >"$INSTALL_DIR/.env" <<EOF
OPENROUTER_API_KEY=$OPENROUTER_API_KEY_INPUT
DATABASE_URL=postgresql://postgres:$POSTGRES_PASSWORD_VALUE@postgres:5432/vivd
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$POSTGRES_PASSWORD_VALUE
POSTGRES_DB=vivd
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET_VALUE
DOMAIN=$PRIMARY_ORIGIN
VIVD_CADDY_PRIMARY_HOST=$PRIMARY_HOST
VIVD_CADDY_TLS_MODE=$RESOLVED_TLS_MODE
VIVD_CADDY_ACME_EMAIL=$ACME_EMAIL_INPUT
VIVD_PUBLISH_INCLUDE_WWW_ALIAS=false
SCRAPER_API_KEY=$SCRAPER_API_KEY_VALUE
TENANT_DOMAIN_ROUTING_ENABLED=false
STUDIO_MACHINE_PROVIDER=docker
VIVD_BUCKET_MODE=local
VIVD_LOCAL_S3_BUCKET=$LOCAL_S3_BUCKET_VALUE
VIVD_LOCAL_S3_ENDPOINT_URL=http://minio:9000
VIVD_LOCAL_S3_DOWNLOAD_ENDPOINT_URL=$PRIMARY_ORIGIN/_vivd_s3
VIVD_LOCAL_S3_ACCESS_KEY=$LOCAL_S3_ACCESS_KEY_VALUE
VIVD_LOCAL_S3_SECRET_KEY=$LOCAL_S3_SECRET_KEY_VALUE
VIVD_LOCAL_S3_REGION=us-east-1
OPENCODE_MODEL_STANDARD=openrouter/google/gemini-3-flash-preview
OPENCODE_MODEL_ADVANCED=openrouter/google/gemini-3.1-pro-preview
VIVD_SELFHOST_IMAGE_TAG=$SELFHOST_IMAGE_TAG_INPUT
VIVD_PUBLIC_DOCS_BASE_URL=https://docs.vivd.studio
DOCKER_STUDIO_NETWORK=vivd-network
DOCKER_STUDIO_ROUTE_PREFIX=/_studio
DOCKER_STUDIO_INTERNAL_PROXY_BASE_URL=http://caddy
DOCKER_STUDIO_IMAGE=ghcr.io/vivd-studio/vivd-studio:$SELFHOST_IMAGE_TAG_INPUT
EOF

if [ "$SINGLE_PROJECT_MODE_INPUT" = "true" ]; then
  printf '\nSINGLE_PROJECT_MODE=true\n' >>"$INSTALL_DIR/.env"
fi

log "Wrote install files to $INSTALL_DIR"

if [ "$AUTO_START" = "true" ]; then
  log "Pulling and starting the stack"
  (
    cd "$INSTALL_DIR"
    docker compose pull
    docker compose up -d postgres scraper minio
    docker compose --profile setup run --rm minio-init
    docker compose up -d backend frontend caddy
  )
else
  log "Skipping startup because --no-start was set"
fi

STUDIO_SETUP_URL="$PRIMARY_ORIGIN/vivd-studio"
printf -v STUDIO_SETUP_LINK '%s' "$(format_terminal_link "$STUDIO_SETUP_URL")"

cat <<EOF

Vivd solo install is ready in:
  $INSTALL_DIR

First-time setup:
  Visit:  $STUDIO_SETUP_LINK
  Finish the initial instance setup in Studio.

Primary URLs:
  Site:   $PRIMARY_ORIGIN/
  Studio: $STUDIO_SETUP_LINK

Management:
  cd $INSTALL_DIR
  docker compose ps
  docker compose logs -f

Notes:
  - Caddy TLS mode: $TLS_MODE_NOTE
  - Studio machines run with STUDIO_MACHINE_PROVIDER=docker.
  - Project storage uses the bundled local S3-compatible bucket by default.
EOF
