#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_PREFIX="${IMAGE_PREFIX:-ghcr.io/vivd-studio}"
PLATFORM="${PLATFORM:-linux/amd64}"
IMAGE_TAG_SUFFIX="${IMAGE_TAG_SUFFIX:-}"

print_usage() {
  cat <<'EOF'
Usage: ./scripts/push-images.sh <tag>

Builds and pushes all publish images with the same tag pattern as
.github/workflows/publish.yml:
  - <tag>        (for example v0.6.18)
  - <tag-no-v>   (for example 0.6.18)
  - latest

Environment overrides:
  IMAGE_PREFIX   GHCR image prefix (default: ghcr.io/vivd-studio)
  PLATFORM       Build platform (default: linux/amd64)
  IMAGE_TAG_SUFFIX  Optional suffix appended to pushed tags (example: -arm64)

Example:
  ./scripts/push-images.sh v0.6.18
  PLATFORM=linux/arm64 IMAGE_TAG_SUFFIX=-arm64 ./scripts/push-images.sh v0.6.18
EOF
}

if [[ $# -ne 1 ]]; then
  print_usage
  exit 1
fi

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  print_usage
  exit 0
fi

VERSION="$1"
if [[ ! "$VERSION" =~ ^v.+$ ]]; then
  echo "Tag must start with 'v' (for example: v0.6.18)." >&2
  exit 1
fi

VERSION_NO_V="${VERSION#v}"
if [[ -z "$VERSION_NO_V" ]]; then
  echo "Invalid tag: '$VERSION'" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "docker buildx is required." >&2
  exit 1
fi

build_and_push() {
  local image_name="$1"
  local context="$2"
  local dockerfile="$3"
  local target="${4:-}"
  local repo="${IMAGE_PREFIX}/${image_name}"

  echo
  echo "==> Building and pushing ${repo}"
  echo "    context: ${context}"
  echo "    tags: ${VERSION}${IMAGE_TAG_SUFFIX}, ${VERSION_NO_V}${IMAGE_TAG_SUFFIX}, latest${IMAGE_TAG_SUFFIX}"

  local cmd=(
    docker buildx build
    --platform "$PLATFORM"
    --file "$dockerfile"
    --tag "${repo}:${VERSION}${IMAGE_TAG_SUFFIX}"
    --tag "${repo}:${VERSION_NO_V}${IMAGE_TAG_SUFFIX}"
    --tag "${repo}:latest${IMAGE_TAG_SUFFIX}"
    --push
  )

  if [[ -n "$target" ]]; then
    cmd+=(--target "$target")
  fi

  cmd+=("$context")
  "${cmd[@]}"
}

echo "Publishing images to ${IMAGE_PREFIX} for tag ${VERSION}"
echo "Make sure you are logged in: docker login ghcr.io"

build_and_push "vivd-studio" "." "packages/studio/Dockerfile" "prod"
build_and_push "vivd-server" "." "packages/backend/Dockerfile" "prod"
build_and_push "vivd-ui" "." "packages/frontend/Dockerfile" "prod"
build_and_push "vivd-docs" "." "packages/docs/Dockerfile" "prod"
build_and_push "vivd-scraper" "packages/scraper" "packages/scraper/Dockerfile"
build_and_push "vivd-caddy" "." "caddy/Dockerfile"

echo
echo "Done. Pushed tags for:"
echo "- ${IMAGE_PREFIX}/vivd-studio:${VERSION}${IMAGE_TAG_SUFFIX}, ${VERSION_NO_V}${IMAGE_TAG_SUFFIX}, latest${IMAGE_TAG_SUFFIX}"
echo "- ${IMAGE_PREFIX}/vivd-server:${VERSION}${IMAGE_TAG_SUFFIX}, ${VERSION_NO_V}${IMAGE_TAG_SUFFIX}, latest${IMAGE_TAG_SUFFIX}"
echo "- ${IMAGE_PREFIX}/vivd-ui:${VERSION}${IMAGE_TAG_SUFFIX}, ${VERSION_NO_V}${IMAGE_TAG_SUFFIX}, latest${IMAGE_TAG_SUFFIX}"
echo "- ${IMAGE_PREFIX}/vivd-docs:${VERSION}${IMAGE_TAG_SUFFIX}, ${VERSION_NO_V}${IMAGE_TAG_SUFFIX}, latest${IMAGE_TAG_SUFFIX}"
echo "- ${IMAGE_PREFIX}/vivd-scraper:${VERSION}${IMAGE_TAG_SUFFIX}, ${VERSION_NO_V}${IMAGE_TAG_SUFFIX}, latest${IMAGE_TAG_SUFFIX}"
echo "- ${IMAGE_PREFIX}/vivd-caddy:${VERSION}${IMAGE_TAG_SUFFIX}, ${VERSION_NO_V}${IMAGE_TAG_SUFFIX}, latest${IMAGE_TAG_SUFFIX}"
