#!/usr/bin/env bash
set -euo pipefail

IMAGE="ghcr.io/vivd-studio/vivd-studio"
TAG="${1:-dev-$(git rev-parse --short HEAD)}"
FULL_IMAGE="${IMAGE}:${TAG}"
REVISION="$(git rev-parse HEAD)"

echo "Building and pushing: ${FULL_IMAGE}"

docker buildx build \
  --platform linux/amd64 \
  --file packages/studio/Dockerfile \
  --target prod \
  --build-arg "VIVD_IMAGE_VERSION=${TAG}" \
  --build-arg "VIVD_IMAGE_REVISION=${REVISION}" \
  --tag "${FULL_IMAGE}" \
  --push \
  .

echo ""
echo "Done: ${FULL_IMAGE}"
