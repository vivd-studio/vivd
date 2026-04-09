import {
  getVivdStudioToken,
  resolveStudioRuntimePath,
  withVivdStudioTokenQuery,
} from "@/lib/studioAuth";

type PreviewLeaveOptions = {
  projectSlug?: string | null;
  version?: number | null;
  sendBeacon?: (url: string, data?: BodyInit | null) => boolean;
};

export function sendPreviewLeaveBeacon(
  options: PreviewLeaveOptions,
): boolean {
  const projectSlug = options.projectSlug?.trim() || "";
  const version = options.version;

  if (!projectSlug) return false;
  if (!Number.isFinite(version) || (version ?? 0) <= 0) return false;

  const payload = JSON.stringify({
    slug: projectSlug,
    version,
  });
  const body = new Blob([payload], { type: "application/json" });
  const sendBeacon =
    options.sendBeacon ?? ((url, data) => navigator.sendBeacon(url, data));

  return sendBeacon(
    withVivdStudioTokenQuery(
      resolveStudioRuntimePath("/vivd-studio/api/cleanup/preview-leave"),
      getVivdStudioToken(),
    ),
    body,
  );
}
