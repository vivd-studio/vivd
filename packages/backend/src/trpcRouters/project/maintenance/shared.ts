import fs from "fs";
import path from "path";

const PROJECT_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function normalizeProjectSlug(input: string, fieldName: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  if (!PROJECT_SLUG_PATTERN.test(normalized)) {
    throw new Error(
      `${fieldName} must use lowercase letters, numbers, and hyphens only`,
    );
  }
  return normalized;
}

export function normalizeProjectTitle(input: string): string {
  const normalized = input.trim();
  if (!normalized) {
    throw new Error("Project title is required");
  }
  return normalized;
}

export function rewriteChecklistProjectSlug(
  checklist: unknown,
  newSlug: string,
): unknown {
  if (!checklist || typeof checklist !== "object" || Array.isArray(checklist)) {
    return checklist;
  }

  return {
    ...(checklist as Record<string, unknown>),
    projectSlug: newSlug,
  };
}

export function moveDirectory(fromPath: string, toPath: string): void {
  if (!fs.existsSync(fromPath)) return;
  if (fs.existsSync(toPath)) {
    throw new Error(`Target path already exists: ${toPath}`);
  }

  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  try {
    fs.renameSync(fromPath, toPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") throw err;
    fs.cpSync(fromPath, toPath, { recursive: true });
    fs.rmSync(fromPath, { recursive: true, force: true });
  }
}
