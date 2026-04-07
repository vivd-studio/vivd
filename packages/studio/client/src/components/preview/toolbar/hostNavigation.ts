import { getVivdHostOrigin, postVivdHostMessage } from "@/lib/hostBridge";
import { openUrlInNewTab as openBrowserUrlInNewTab } from "@/lib/browserActions";

export function getHostAppOrigin() {
  return getVivdHostOrigin();
}

export function buildHostAppUrl(path: string) {
  return new URL(path, getHostAppOrigin()).toString();
}

export function openHostPath(path: string) {
  const url = buildHostAppUrl(path);
  openBrowserUrlInNewTab(url);
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
  section: "plugins",
) {
  return `/vivd-studio/projects/${encodeURIComponent(projectSlug)}/${section}`;
}

export function openUrlInNewTab(url: string) {
  openBrowserUrlInNewTab(url);
}
