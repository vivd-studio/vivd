#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-$ROOT_DIR/geoip}"
TARGET_FILE="$TARGET_DIR/GeoLite2-Country.mmdb"
ENV_FILE="${ROOT_DIR}/.env"
DOWNLOAD_URL="https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz"

usage() {
  cat <<'EOF'
Usage: ./scripts/install-analytics-geoip.sh [target-dir]

Download the MaxMind GeoLite2 Country database into Vivd's default analytics
GeoIP mount directory.

Credentials:
  MAXMIND_ACCOUNT_ID   Required. Your MaxMind account ID.
  MAXMIND_LICENSE_KEY  Required. Your MaxMind license key.

Credential loading order:
  1. Current shell environment
  2. The repo-root .env file (if present)

Examples:
  MAXMIND_ACCOUNT_ID=123 MAXMIND_LICENSE_KEY=abc ./scripts/install-analytics-geoip.sh
  ./scripts/install-analytics-geoip.sh /srv/vivd/geoip

After the file is installed, restart the backend container so analytics country
lookups start using it immediately.
EOF
}

trim_quotes() {
  local value="$1"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

read_env_value() {
  local key="$1"
  local file="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi

  local line
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 0
  fi

  trim_quotes "${line#*=}"
}

resolve_secret() {
  local key="$1"
  local current="${!key:-}"
  if [[ -n "$current" ]]; then
    printf '%s' "$current"
    return 0
  fi

  read_env_value "$key" "$ENV_FILE"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

MAXMIND_ACCOUNT_ID="$(resolve_secret MAXMIND_ACCOUNT_ID)"
MAXMIND_LICENSE_KEY="$(resolve_secret MAXMIND_LICENSE_KEY)"

if [[ -z "$MAXMIND_ACCOUNT_ID" || -z "$MAXMIND_LICENSE_KEY" ]]; then
  echo "Missing MAXMIND_ACCOUNT_ID or MAXMIND_LICENSE_KEY." >&2
  echo "Set them in your shell or in ${ENV_FILE} before running this script." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
ARCHIVE_PATH="$TMP_DIR/geolite2-country.tar.gz"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TARGET_DIR"

echo "Downloading GeoLite2 Country database..."
curl -fsSL \
  --retry 3 \
  --retry-delay 2 \
  --user "${MAXMIND_ACCOUNT_ID}:${MAXMIND_LICENSE_KEY}" \
  --output "$ARCHIVE_PATH" \
  "$DOWNLOAD_URL"

tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"

MMDB_PATH="$(find "$TMP_DIR" -type f -name 'GeoLite2-Country.mmdb' | head -n 1)"
if [[ -z "$MMDB_PATH" ]]; then
  echo "Could not find GeoLite2-Country.mmdb inside the downloaded archive." >&2
  exit 1
fi

install -m 0644 "$MMDB_PATH" "$TARGET_FILE"

echo "Installed analytics GeoIP database:"
ls -lh "$TARGET_FILE"
echo
echo "Next step:"
echo "  Restart the backend container so analytics country lookups use the new database immediately."
