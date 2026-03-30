function resolveOrigin(value: string | null): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getVivdHostOrigin(): string {
  const params = new URLSearchParams(window.location.search);

  const explicitHostOrigin = resolveOrigin(params.get("hostOrigin"));
  if (explicitHostOrigin) return explicitHostOrigin;

  const returnToOrigin = resolveOrigin(params.get("returnTo"));
  if (returnToOrigin) return returnToOrigin;

  const referrerOrigin = resolveOrigin(document.referrer || null);
  if (referrerOrigin) return referrerOrigin;

  return window.location.origin;
}

export function isVivdHostMessageEvent(event: MessageEvent): boolean {
  if (window.parent === window) return false;
  return event.source === window.parent && event.origin === getVivdHostOrigin();
}

export function postVivdHostMessage(message: unknown): void {
  if (window.parent === window) return;
  window.parent.postMessage(message, getVivdHostOrigin());
}
