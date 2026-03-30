import { getVivdHostOrigin, postVivdHostMessage } from "@/lib/hostBridge";

export function getHostAppOrigin() {
  return getVivdHostOrigin();
}

export function buildHostAppUrl(path: string) {
  return new URL(path, getHostAppOrigin()).toString();
}

export function openHostPath(path: string) {
  const url = buildHostAppUrl(path);
  const nextWindow = window.open(url, "_blank", "noopener,noreferrer");
  if (!nextWindow) {
    window.location.assign(url);
  }
}

export function openEmbeddedStudioPath(path: string, embedded?: boolean) {
  if (embedded) {
    postVivdHostMessage({ type: "vivd:studio:navigate", path });
    return;
  }

  openHostPath(path);
}

export function buildProjectStudioPath(
  projectSlug: string,
  section: "plugins" | "analytics",
) {
  return `/vivd-studio/projects/${encodeURIComponent(projectSlug)}/${section}`;
}
