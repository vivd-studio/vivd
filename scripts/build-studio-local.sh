#!/usr/bin/env bash
set -euo pipefail

IMAGE_REPO="${DOCKER_STUDIO_LOCAL_IMAGE_REPO:-vivd-studio}"
TAG="${1:-local}"
FULL_IMAGE="${IMAGE_REPO}:${TAG}"
PLATFORM="${DOCKER_STUDIO_LOCAL_PLATFORM:-}"

echo "Building local Studio image: ${FULL_IMAGE}"

BUILD_ARGS=(
  docker build
  --file packages/studio/Dockerfile
  --target prod
  --tag "${FULL_IMAGE}"
)

if [[ -n "${PLATFORM}" ]]; then
  BUILD_ARGS+=(--platform "${PLATFORM}")
fi

BUILD_ARGS+=(.)
"${BUILD_ARGS[@]}"

echo ""
echo "Done: ${FULL_IMAGE}"
echo "Set DOCKER_STUDIO_IMAGE=${FULL_IMAGE} and restart the backend plus any running Studio runtimes to use it."
