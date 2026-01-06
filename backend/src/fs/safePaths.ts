import fs from "fs";
import path from "path";
import { hasDotSegment } from "../generator/vivdPaths";

export type SafeJoinOptions = {
  /**
   * Default: false (deny any path segment starting with ".")
   * This blocks ".vivd/", ".git/", "..", ".env", etc.
   */
  allowDotSegments?: boolean;
};

function isPathInside(baseDir: string, candidate: string): boolean {
  const rel = path.relative(baseDir, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function findExistingAncestor(targetPath: string): string {
  let current = targetPath;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fs.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

function splitRelativeSegments(relativePath: string): string[] {
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean);
}

function assertNoSymlinkSegments(baseDir: string, targetPath: string): void {
  const relative = path.relative(baseDir, targetPath);
  const segments = splitRelativeSegments(relative);

  let current = baseDir;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const next = path.join(current, seg);

    if (!fs.existsSync(next)) {
      current = next;
      continue;
    }

    const st = fs.lstatSync(next);
    if (st.isSymbolicLink()) {
      throw new Error("Invalid path (symlink not allowed)");
    }

    const isLast = i === segments.length - 1;
    if (!isLast && !st.isDirectory()) {
      throw new Error("Invalid path");
    }

    current = next;
  }
}

/**
 * Safely join a user-provided relative path to a trusted base directory.
 *
 * Guarantees:
 * - `relativePath` cannot escape `baseDir` via traversal or absolute paths
 * - no existing path segment under `baseDir` may be a symlink (prevents symlink escapes)
 * - by default, rejects any segment starting with "." (incl. "..", ".vivd", ".git")
 */
export function safeJoin(
  baseDir: string,
  relativePath: string,
  options: SafeJoinOptions = {}
): string {
  if (relativePath.includes("\0")) {
    throw new Error("Invalid path");
  }

  const allowDotSegments = options.allowDotSegments ?? false;
  const normalizedRel = relativePath.replace(/\\/g, "/").trim();

  if (normalizedRel === "") {
    return path.resolve(baseDir);
  }

  // Absolute path (posix) or drive letter (windows) must be rejected.
  if (path.isAbsolute(normalizedRel) || /^[a-zA-Z]:[\\/]/.test(normalizedRel)) {
    throw new Error("Invalid path");
  }

  if (!allowDotSegments && hasDotSegment(normalizedRel)) {
    throw new Error("Invalid path");
  }

  const baseAbs = path.resolve(baseDir);
  const candidateAbs = path.resolve(baseAbs, normalizedRel);

  if (candidateAbs === baseAbs || !isPathInside(baseAbs, candidateAbs)) {
    throw new Error("Invalid path");
  }

  // Ensure no symlink exists in any already-existing path segment.
  assertNoSymlinkSegments(baseAbs, candidateAbs);

  // Ensure the closest existing ancestor is still inside the real base dir.
  const baseReal = fs.realpathSync(baseAbs);
  const ancestor = findExistingAncestor(candidateAbs);
  if (fs.existsSync(ancestor)) {
    const ancestorReal = fs.realpathSync(ancestor);
    if (ancestorReal !== baseReal && !isPathInside(baseReal, ancestorReal)) {
      throw new Error("Invalid path");
    }
  }

  return candidateAbs;
}

