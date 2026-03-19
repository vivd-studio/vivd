#!/usr/bin/env bash
set -euo pipefail

DEFAULT_INSTALLER_BASE_URL="https://docs.vivd.studio/install"
INSTALLER_BASE_URL="${VIVD_INSTALLER_BASE_URL:-$DEFAULT_INSTALLER_BASE_URL}"
INSTALL_DIR="${VIVD_INSTALL_DIR:-$HOME/vivd}"
PRIMARY_HOST_INPUT="${VIVD_DOMAIN:-}"
OPENROUTER_API_KEY_INPUT="${OPENROUTER_API_KEY:-}"
SINGLE_PROJECT_MODE_INPUT="${VIVD_SINGLE_PROJECT_MODE:-true}"
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
  --single-project <bool>    true or false (default: true)
  --no-start                 Write files but do not start Docker Compose
  --help                     Show this message

Environment overrides:
  VIVD_INSTALLER_BASE_URL
  VIVD_INSTALL_DIR
  VIVD_DOMAIN
  OPENROUTER_API_KEY
  VIVD_SINGLE_PROJECT_MODE
EOF
}

log() {
  printf '[vivd-install] %s\n' "$*"
}

fail() {
  printf '[vivd-install] ERROR: %s\n' "$*" >&2
  exit 1
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

normalize_host() {
  local raw="$1"
  raw="${raw#http://}"
  raw="${raw#https://}"
  raw="${raw%%/*}"
  raw="${raw%%\?*}"
  raw="${raw%%#*}"
  printf '%s' "${raw%/}"
}

normalize_origin() {
  local raw="$1"
  if [[ "$raw" == http://* || "$raw" == https://* ]]; then
    printf '%s' "${raw%/}"
    return
  fi

  local host
  host="$(normalize_host "$raw")"
  if is_local_host "$host"; then
    printf 'http://%s' "$host"
  else
    printf 'https://%s' "$host"
  fi
}

prompt_if_empty() {
  local var_name="$1"
  local prompt="$2"
  local secret="${3:-false}"
  local current_value
  current_value="${!var_name:-}"
  if [ -n "$current_value" ]; then
    return
  fi

  if [ "$secret" = "true" ]; then
    printf '%s: ' "$prompt" >&2
    stty -echo
    IFS= read -r current_value
    stty echo
    printf '\n' >&2
  else
    printf '%s: ' "$prompt" >&2
    IFS= read -r current_value
  fi

  [ -n "$current_value" ] || fail "$prompt is required"
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

PRIMARY_HOST="$(normalize_host "$PRIMARY_HOST_INPUT")"
[ -n "$PRIMARY_HOST" ] || fail "Could not parse a primary host from: $PRIMARY_HOST_INPUT"

PRIMARY_ORIGIN="$(normalize_origin "$PRIMARY_HOST_INPUT")"
BETTER_AUTH_SECRET_VALUE="$(generate_secret)"
SCRAPER_API_KEY_VALUE="$(generate_secret)"
POSTGRES_PASSWORD_VALUE="$(generate_secret)"

mkdir -p "$INSTALL_DIR"

for target in docker-compose.yml Caddyfile .env; do
  if [ -e "$INSTALL_DIR/$target" ]; then
    fail "Refusing to overwrite existing $INSTALL_DIR/$target"
  fi
done

log "Downloading solo self-host bundle from $INSTALLER_BASE_URL"
download_file "$INSTALLER_BASE_URL/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
download_file "$INSTALLER_BASE_URL/Caddyfile" "$INSTALL_DIR/Caddyfile"

cat >"$INSTALL_DIR/.env" <<EOF
OPENROUTER_API_KEY=$OPENROUTER_API_KEY_INPUT
DATABASE_URL=postgresql://postgres:$POSTGRES_PASSWORD_VALUE@postgres:5432/vivd
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$POSTGRES_PASSWORD_VALUE
POSTGRES_DB=vivd
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET_VALUE
BETTER_AUTH_URL=$PRIMARY_ORIGIN
DOMAIN=$PRIMARY_ORIGIN
CONTROL_PLANE_HOST=$PRIMARY_HOST
SUPERADMIN_HOSTS=$PRIMARY_HOST
TRUSTED_DOMAINS=$PRIMARY_HOST
SCRAPER_API_KEY=$SCRAPER_API_KEY_VALUE
VIVD_INSTALL_PROFILE=solo
TENANT_DOMAIN_ROUTING_ENABLED=false
STUDIO_MACHINE_PROVIDER=docker
SINGLE_PROJECT_MODE=$SINGLE_PROJECT_MODE_INPUT
VIVD_PUBLIC_DOCS_BASE_URL=https://docs.vivd.studio
DOCKER_STUDIO_NETWORK=vivd-network
DOCKER_STUDIO_ROUTE_PREFIX=/_studio
DOCKER_STUDIO_INTERNAL_PROXY_BASE_URL=http://caddy
EOF

log "Wrote install files to $INSTALL_DIR"

if [ "$AUTO_START" = "true" ]; then
  log "Pulling and starting the stack"
  (
    cd "$INSTALL_DIR"
    docker compose pull
    docker compose up -d
  )
else
  log "Skipping startup because --no-start was set"
fi

cat <<EOF

Vivd solo install is ready in:
  $INSTALL_DIR

Primary URLs:
  Site:   $PRIMARY_ORIGIN/
  Studio: $PRIMARY_ORIGIN/vivd-studio

Management:
  cd $INSTALL_DIR
  docker compose ps
  docker compose logs -f

Notes:
  - This installer deploys the solo profile only.
  - Studio machines run with STUDIO_MACHINE_PROVIDER=docker.
EOF
