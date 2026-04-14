/**
 * Shared import utilities for ZIP file uploads.
 */

const DEFAULT_ZIP_IMPORT_MAX_FILE_SIZE_MB = 100;

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

  const responseText = await response.text();
  const payload = (() => {
    if (!responseText.trim()) return null;
    try {
      const parsed = JSON.parse(responseText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed as {
        error?: string;
        slug?: string;
        version?: number;
      };
    } catch {
      return null;
    }
  })() as {
    error?: string;
    slug?: string;
    version?: number;
  } | null;

  if (!response.ok) {
    if (response.status === 413) {
      throw new Error(
        `ZIP file is too large. Maximum size is ${DEFAULT_ZIP_IMPORT_MAX_FILE_SIZE_MB}MB.`,
      );
    }
    if (payload?.error) {
      throw new Error(payload.error);
    }
    const fallbackMessage = responseText.trim();
    if (fallbackMessage && !fallbackMessage.startsWith("<")) {
      throw new Error(fallbackMessage);
    }
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
