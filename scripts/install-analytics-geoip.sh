#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/geoip"
TARGET_FILE="$TARGET_DIR/GeoLite2-Country.mmdb"
ENV_FILE="${ROOT_DIR}/.env"
PROVIDER="dbip-lite"
DBIP_DOWNLOAD_PAGE_URL="https://db-ip.com/db/download/ip-to-country-lite"
MAXMIND_DOWNLOAD_URL="https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz"

usage() {
  cat <<'EOF'
Usage: ./scripts/install-analytics-geoip.sh [--provider dbip-lite|maxmind] [target-dir]

Download a country MMDB database into Vivd's default analytics GeoIP mount
directory.

Providers:
  dbip-lite  Default. Free DB-IP Lite Country MMDB download with no credentials.
  maxmind    MaxMind GeoLite2 Country download using account credentials.

Credentials:
  MAXMIND_ACCOUNT_ID   Required only for --provider=maxmind.
  MAXMIND_LICENSE_KEY  Required only for --provider=maxmind.

Credential loading order:
  1. Current shell environment
  2. The repo-root .env file (if present)

Examples:
  ./scripts/install-analytics-geoip.sh
  ./scripts/install-analytics-geoip.sh /srv/vivd/geoip
  ./scripts/install-analytics-geoip.sh --provider dbip-lite
  MAXMIND_ACCOUNT_ID=123 MAXMIND_LICENSE_KEY=abc ./scripts/install-analytics-geoip.sh --provider=maxmind

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

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help|-h)
        usage
        exit 0
        ;;
      --provider)
        if [[ $# -lt 2 ]]; then
          echo "Missing value for --provider." >&2
          exit 1
        fi
        PROVIDER="$2"
        shift 2
        ;;
      --provider=*)
        PROVIDER="${1#*=}"
        shift
        ;;
      --*)
        echo "Unknown option: $1" >&2
        exit 1
        ;;
      *)
        if [[ "$TARGET_DIR" != "$ROOT_DIR/geoip" ]]; then
          echo "Only one target directory may be provided." >&2
          exit 1
        fi
        TARGET_DIR="$1"
        shift
        ;;
    esac
  done
}

normalize_provider() {
  case "$1" in
    dbip|dbip-lite|db_ip|db-ip)
      printf '%s' "dbip-lite"
      ;;
    maxmind)
      printf '%s' "maxmind"
      ;;
    *)
      return 1
      ;;
  esac
}

download_dbip_lite() {
  local page_path="$TMP_DIR/dbip-download-page.html"
  local archive_path="$TMP_DIR/dbip-country.mmdb.gz"
  local extracted_path="$TMP_DIR/dbip-country.mmdb"
  local download_url

  echo "Resolving latest DB-IP Lite Country MMDB download URL..."
  curl -fsSL \
    --retry 3 \
    --retry-delay 2 \
    --output "$page_path" \
    "$DBIP_DOWNLOAD_PAGE_URL"

  download_url="$(grep -oE "https://download\\.db-ip\\.com/free/[^\"' ]+\\.mmdb(\\.gz)?" "$page_path" | head -n 1 || true)"

  if [[ -z "$download_url" ]]; then
    echo "Could not find the DB-IP Lite MMDB download URL on ${DBIP_DOWNLOAD_PAGE_URL}." >&2
    exit 1
  fi

  echo "Downloading DB-IP Lite Country MMDB..."
  curl -fsSL \
    --retry 3 \
    --retry-delay 2 \
    --output "$archive_path" \
    "$download_url"

  if [[ "$download_url" == *.gz ]]; then
    gzip -dc "$archive_path" > "$extracted_path"
  else
    cp "$archive_path" "$extracted_path"
  fi

  if [[ ! -s "$extracted_path" ]]; then
    echo "DB-IP Lite download did not produce a readable MMDB file." >&2
    exit 1
  fi

  MMDB_PATH="$extracted_path"
}

download_maxmind() {
  local archive_path="$TMP_DIR/geolite2-country.tar.gz"
  local maxmind_account_id
  local maxmind_license_key

  maxmind_account_id="$(resolve_secret MAXMIND_ACCOUNT_ID)"
  maxmind_license_key="$(resolve_secret MAXMIND_LICENSE_KEY)"

  if [[ -z "$maxmind_account_id" || -z "$maxmind_license_key" ]]; then
    echo "Missing MAXMIND_ACCOUNT_ID or MAXMIND_LICENSE_KEY." >&2
    echo "Set them in your shell or in ${ENV_FILE} before running this script." >&2
    exit 1
  fi

  echo "Downloading MaxMind GeoLite2 Country database..."
  curl -fsSL \
    --retry 3 \
    --retry-delay 2 \
    --user "${maxmind_account_id}:${maxmind_license_key}" \
    --output "$archive_path" \
    "$MAXMIND_DOWNLOAD_URL"

  tar -xzf "$archive_path" -C "$TMP_DIR"

  MMDB_PATH="$(find "$TMP_DIR" -type f -name 'GeoLite2-Country.mmdb' | head -n 1)"
  if [[ -z "$MMDB_PATH" ]]; then
    echo "Could not find GeoLite2-Country.mmdb inside the downloaded archive." >&2
    exit 1
  fi
}

parse_args "$@"

if ! PROVIDER="$(normalize_provider "$PROVIDER")"; then
  echo "Unsupported provider: $PROVIDER" >&2
  echo "Expected one of: dbip-lite, maxmind" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
MMDB_PATH=""

mkdir -p "$TARGET_DIR"

case "$PROVIDER" in
  dbip-lite)
    download_dbip_lite
    ;;
  maxmind)
    download_maxmind
    ;;
esac

install -m 0644 "$MMDB_PATH" "$TARGET_FILE"

echo "Installed analytics GeoIP database:"
ls -lh "$TARGET_FILE"
echo

if [[ "$PROVIDER" == "dbip-lite" ]]; then
  echo "Attribution reminder:"
  echo "  DB-IP Lite requires a visible link back to https://db-ip.com on pages that display or use the resulting country data."
  echo
fi

echo "Next step:"
echo "  Restart the backend container so analytics country lookups use the new database immediately."
