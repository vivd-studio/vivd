#!/usr/bin/env bash
set -euo pipefail

TAG="local"
PROJECT_SLUG=""
SKIP_BUILD=0

usage() {
  cat <<'EOF'
Usage: ./scripts/studio-dev-refresh.sh [--tag <tag>] [--project-slug <slug>] [--no-build]

Builds the local Studio image and stops matching managed Docker-provider Studio runtimes,
so the next open/restart can come back on the rebuilt image.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "--tag requires a value" >&2
        exit 1
      fi
      TAG="${2:-}"
      shift 2
      ;;
    --project-slug)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "--project-slug requires a value" >&2
        exit 1
      fi
      PROJECT_SLUG="${2:-}"
      shift 2
      ;;
    --no-build)
      SKIP_BUILD=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  "$(dirname "$0")/build-studio-local.sh" "$TAG"
fi

filters=(
  --filter "label=vivd_managed=true"
  --filter "label=vivd_provider=docker"
)

if [[ -n "$PROJECT_SLUG" ]]; then
  filters+=(--filter "label=vivd_project_slug=$PROJECT_SLUG")
fi

running_containers=()
while IFS= read -r row; do
  if [[ -n "$row" ]]; then
    running_containers+=("$row")
  fi
done < <(docker ps --format '{{.ID}}	{{.Names}}' "${filters[@]}")

if [[ "${#running_containers[@]}" -eq 0 ]]; then
  echo "No running managed Docker-provider Studio containers matched."
else
  echo "Stopping managed Docker-provider Studio containers:"
  for row in "${running_containers[@]}"; do
    container_id="${row%%$'\t'*}"
    container_name="${row#*$'\t'}"
    echo "  - ${container_name} (${container_id})"
    docker stop "$container_id" >/dev/null
  done
fi

image_repo="${DOCKER_STUDIO_LOCAL_IMAGE_REPO:-vivd-studio}"
echo ""
echo "Refreshed local Studio image ${image_repo}:${TAG}."
echo "Stopped Docker-provider runtimes will reconcile onto the rebuilt image on the next open/restart."
echo "If your backend is not configured with DOCKER_STUDIO_IMAGE=${image_repo}:${TAG}, update that first."
