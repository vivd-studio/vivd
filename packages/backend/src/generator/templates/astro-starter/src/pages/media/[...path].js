import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SOURCE_MEDIA_ROOT = path.join(PROJECT_ROOT, "src", "content", "media");
const ARTIFACT_MEDIA_ROOT = path.join(PROJECT_ROOT, ".vivd", "content", "media");

export const prerender = true;

function normalizeRequestPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^media\/+/, "");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function safeJoin(rootDir, relativePath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(resolvedRoot + path.sep)
  ) {
    return null;
  }
  return resolvedPath;
}

async function listFiles(rootDir, prefix = "") {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await listFiles(absolutePath, relativePath)));
      continue;
    }

    if (entry.isFile()) {
      results.push(relativePath);
    }
  }

  return results;
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".avif":
      return "image/avif";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".json":
      return "application/json";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".webp":
      return "image/webp";
    case ".xml":
      return "application/xml";
    default:
      return "application/octet-stream";
  }
}

async function getMediaRoots() {
  const roots = [];
  if (await pathExists(SOURCE_MEDIA_ROOT)) {
    roots.push(SOURCE_MEDIA_ROOT);
  }
  if (await pathExists(ARTIFACT_MEDIA_ROOT)) {
    roots.push(ARTIFACT_MEDIA_ROOT);
  }
  return Array.from(new Set(roots));
}

export const getStaticPaths = async () => {
  const roots = await getMediaRoots();
  const seen = new Set();

  for (const rootDir of roots) {
    for (const relativePath of await listFiles(rootDir)) {
      seen.add(relativePath);
    }
  }

  return Array.from(seen).map((relativePath) => ({
    params: {
      path: relativePath,
    },
  }));
};

export const GET = async ({ params }) => {
  const requestedPath = normalizeRequestPath(
    typeof params.path === "string" ? params.path : "",
  );

  if (!requestedPath) {
    return new Response("Not found", { status: 404 });
  }

  for (const rootDir of await getMediaRoots()) {
    const filePath = safeJoin(rootDir, requestedPath);
    if (!filePath) {
      continue;
    }

    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        continue;
      }

      const body = await fs.readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": getMimeType(filePath),
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch {
      continue;
    }
  }

  return new Response("Not found", { status: 404 });
};
