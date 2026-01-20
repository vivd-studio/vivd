/**
 * Shared import utilities for ZIP file uploads.
 */

export interface ImportResult {
  slug: string;
  version?: number;
}

/**
 * Import a project from a ZIP file.
 * @param file - The ZIP file to import
 * @returns The import result with project slug and version
 * @throws Error if import fails
 */
export async function importProjectZip(file: File): Promise<ImportResult> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/vivd-studio/api/import", {
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
