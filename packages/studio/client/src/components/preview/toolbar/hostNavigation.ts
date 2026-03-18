export function getHostAppOrigin() {
  const params = new URLSearchParams(window.location.search);

  const hostOrigin = params.get("hostOrigin");
  if (hostOrigin) {
    try {
      return new URL(hostOrigin).origin;
    } catch {
      // Ignore invalid values.
    }
  }

  const returnTo = params.get("returnTo");
  if (returnTo) {
    try {
      return new URL(returnTo).origin;
    } catch {
      // Ignore invalid values.
    }
  }

  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      // Ignore invalid values.
    }
  }

  return window.location.origin;
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
    window.parent?.postMessage({ type: "vivd:studio:navigate", path }, "*");
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
