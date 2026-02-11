/**
 * Shared import utilities for ZIP file uploads.
 */

export interface ImportResult {
  slug: string;
  version?: number;
}

export interface ImportProjectZipOptions {
  organizationId?: string;
}

/**
 * Import a project from a ZIP file.
 * @param file - The ZIP file to import
 * @param options - Optional import options (like organizationId)
 * @returns The import result with project slug and version
 * @throws Error if import fails
 */
export async function importProjectZip(
  file: File,
  options?: ImportProjectZipOptions,
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append("file", file);

  const organizationId = options?.organizationId?.trim();
  const url = organizationId
    ? `/vivd-studio/api/import?organizationId=${encodeURIComponent(organizationId)}`
    : "/vivd-studio/api/import";

  const response = await fetch(url, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    slug?: string;
    version?: number;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Import failed");
  }

  if (!payload?.slug) {
    throw new Error("Import failed: missing project slug");
  }

  return {
    slug: payload.slug,
    version: payload.version,
  };
}
