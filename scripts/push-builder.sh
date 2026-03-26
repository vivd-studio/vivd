#!/usr/bin/env bash
set -euo pipefail

IMAGE="ghcr.io/vivd-studio/vivd-builder"
TAG="${1:-dev-$(git rev-parse --short HEAD)}"
FULL_IMAGE="${IMAGE}:${TAG}"

echo "Building and pushing: ${FULL_IMAGE}"

docker buildx build \
  --platform linux/amd64 \
  --file packages/builder/Dockerfile \
  --target prod \
  --tag "${FULL_IMAGE}" \
  --push \
  .

echo ""
echo "Done: ${FULL_IMAGE}"
