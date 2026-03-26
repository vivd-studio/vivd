import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  type ArtifactBuildKind,
  type ArtifactBuildMeta,
  createS3Client,
  downloadBucketPrefixToDirectory,
  getObjectStorageConfigFromEnv,
  getProjectArtifactKeyPrefix,
  readArtifactBuildMeta,
  replaceBucketPrefixWithDirectory,
  writeArtifactBuildMeta,
} from "./storage.js";
import { detectProjectType, hasNodeModules } from "./projectType.js";

export type {
  ArtifactBuildKind,
  ArtifactBuildMeta,
  ObjectStorageConfig,
} from "./storage.js";
export {
  createS3Client,
  downloadBucketPrefixToDirectory,
  getObjectStorageConfigFromEnv,
  getProjectArtifactKeyPrefix,
  getProjectBuildMetaKey,
  readArtifactBuildMeta,
  replaceBucketPrefixWithDirectory,
  writeArtifactBuildMeta,
} from "./storage.js";

export type RunProjectArtifactBuildOptions = {
  organizationId: string;
  slug: string;
  version: number;
  kind: ArtifactBuildKind;
  commitHash?: string;
  env?: NodeJS.ProcessEnv;
};

export type RunProjectArtifactBuildResult =
  | { status: "ready"; framework: "astro" | "generic" }
  | { status: "skipped"; reason: "stale_request" | "not_buildable"; framework: "astro" | "generic" };

function resolvePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveNodeOptions(options: {
  env: NodeJS.ProcessEnv;
  maxOldSpaceMb?: number;
}): string | undefined {
  const existing = (options.env.NODE_OPTIONS || "").trim();
  if (!options.maxOldSpaceMb || options.maxOldSpaceMb <= 0) {
    return existing || undefined;
  }

  const filtered = existing
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !part.startsWith("--max-old-space-size="));

  filtered.push(`--max-old-space-size=${options.maxOldSpaceMb}`);
  return filtered.join(" ");
}

function resolveInstallCommand(
  projectDir: string,
  packageManager: "npm" | "pnpm" | "yarn",
): { cmd: string; args: string[] } {
  if (packageManager === "pnpm") {
    return fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))
      ? { cmd: "pnpm", args: ["install", "--frozen-lockfile", "--prefer-offline"] }
      : { cmd: "pnpm", args: ["install", "--prefer-offline"] };
  }
  if (packageManager === "yarn") {
    return fs.existsSync(path.join(projectDir, "yarn.lock"))
      ? { cmd: "yarn", args: ["install", "--frozen-lockfile", "--prefer-offline"] }
      : { cmd: "yarn", args: ["install", "--prefer-offline"] };
  }
  return fs.existsSync(path.join(projectDir, "package-lock.json")) ||
    fs.existsSync(path.join(projectDir, "npm-shrinkwrap.json"))
    ? { cmd: "npm", args: ["ci", "--prefer-offline", "--no-audit", "--no-fund"] }
    : { cmd: "npm", args: ["install", "--prefer-offline", "--no-audit", "--no-fund"] };
}

async function runCommand(options: {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  label: string;
  timeoutMs: number;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(options.cmd, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(new Error(`${options.label} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    timeout.unref?.();

    proc.stdout?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.log(`[${options.label}] ${text}`);
    });
    proc.stderr?.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[${options.label}] ${text}`);
    });

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${options.label} failed (exit code ${code ?? 1})`));
    });
  });
}

async function ensureAstroBuild(options: {
  projectDir: string;
  commitHash?: string;
  env: NodeJS.ProcessEnv;
}): Promise<string> {
  const config = detectProjectType(options.projectDir);
  if (config.framework !== "astro") {
    throw new Error("Not an Astro project");
  }

  const installTimeoutMs = resolvePositiveInt(
    options.env.VIVD_BUILDER_INSTALL_TIMEOUT_MS,
    15 * 60 * 1000,
  );
  const buildTimeoutMs = resolvePositiveInt(
    options.env.VIVD_BUILDER_BUILD_TIMEOUT_MS,
    15 * 60 * 1000,
  );
  const installMaxOldSpaceMb = resolvePositiveInt(
    options.env.VIVD_BUILDER_INSTALL_MAX_OLD_SPACE_MB,
    0,
  );
  const buildMaxOldSpaceMb = resolvePositiveInt(
    options.env.VIVD_BUILDER_ASTRO_MAX_OLD_SPACE_MB ||
      options.env.VIVD_BUILDER_MAX_OLD_SPACE_MB,
    0,
  );

  if (!hasNodeModules(options.projectDir)) {
    const install = resolveInstallCommand(options.projectDir, config.packageManager);
    await runCommand({
      cmd: install.cmd,
      args: install.args,
      cwd: options.projectDir,
      env: {
        ...options.env,
        ...(resolveNodeOptions({
          env: options.env,
          maxOldSpaceMb: installMaxOldSpaceMb,
        })
          ? {
              NODE_OPTIONS: resolveNodeOptions({
                env: options.env,
                maxOldSpaceMb: installMaxOldSpaceMb,
              }),
            }
          : {}),
      },
      label: "BuilderInstall",
      timeoutMs: installTimeoutMs,
    });
  }

  const astroBin = path.join(options.projectDir, "node_modules", ".bin", "astro");
  if (!fs.existsSync(astroBin)) {
    throw new Error("Astro CLI not found (node_modules/.bin/astro)");
  }

  const distDir = path.join(options.projectDir, "dist");
  await runCommand({
    cmd: astroBin,
    args: ["build", "--outDir", "dist"],
    cwd: options.projectDir,
    env: {
      ...options.env,
      ...(resolveNodeOptions({
        env: options.env,
        maxOldSpaceMb: buildMaxOldSpaceMb,
      })
        ? {
            NODE_OPTIONS: resolveNodeOptions({
              env: options.env,
              maxOldSpaceMb: buildMaxOldSpaceMb,
            }),
          }
        : {}),
    },
    label: "BuilderAstroBuild",
    timeoutMs: buildTimeoutMs,
  });

  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    throw new Error("Astro build completed but dist/index.html was not produced");
  }

  return distDir;
}

function buildMetaMatchesCommit(
  meta: ArtifactBuildMeta | null,
  commitHash: string | undefined,
): boolean {
  if (!commitHash) return true;
  return (meta?.commitHash || "") === commitHash;
}

export async function runProjectArtifactBuild(
  options: RunProjectArtifactBuildOptions,
): Promise<RunProjectArtifactBuildResult> {
  const env = options.env ?? process.env;
  const storageConfig = getObjectStorageConfigFromEnv(env);
  const client = createS3Client(storageConfig);
  const sourcePrefix = getProjectArtifactKeyPrefix({
    organizationId: options.organizationId,
    slug: options.slug,
    version: options.version,
    kind: "source",
  });
  const targetPrefix = getProjectArtifactKeyPrefix({
    organizationId: options.organizationId,
    slug: options.slug,
    version: options.version,
    kind: options.kind,
  });

  const currentTargetMeta = await readArtifactBuildMeta({
    client,
    bucket: storageConfig.bucket,
    organizationId: options.organizationId,
    slug: options.slug,
    version: options.version,
    kind: options.kind,
  });

  if (!buildMetaMatchesCommit(currentTargetMeta, options.commitHash)) {
    return { status: "skipped", reason: "stale_request", framework: "generic" };
  }

  const startedAt = new Date().toISOString();
  await writeArtifactBuildMeta({
    client,
    bucket: storageConfig.bucket,
    organizationId: options.organizationId,
    slug: options.slug,
    version: options.version,
    kind: options.kind,
    meta: {
      status: "building",
      framework: "generic",
      commitHash: options.commitHash,
      startedAt,
    },
  });

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-builder-"));
  try {
    await downloadBucketPrefixToDirectory({
      client,
      bucket: storageConfig.bucket,
      keyPrefix: sourcePrefix,
      localDir: workspaceDir,
    });

    const projectType = detectProjectType(workspaceDir);
    if (projectType.framework !== "astro") {
      await writeArtifactBuildMeta({
        client,
        bucket: storageConfig.bucket,
        organizationId: options.organizationId,
        slug: options.slug,
        version: options.version,
        kind: options.kind,
        meta: {
          status: "ready",
          framework: "generic",
          commitHash: options.commitHash,
          startedAt,
          completedAt: new Date().toISOString(),
        },
      });
      return { status: "skipped", reason: "not_buildable", framework: "generic" };
    }

    const distDir = await ensureAstroBuild({
      projectDir: workspaceDir,
      commitHash: options.commitHash,
      env,
    });

    const latestMeta = await readArtifactBuildMeta({
      client,
      bucket: storageConfig.bucket,
      organizationId: options.organizationId,
      slug: options.slug,
      version: options.version,
      kind: options.kind,
    });
    if (!buildMetaMatchesCommit(latestMeta, options.commitHash)) {
      return { status: "skipped", reason: "stale_request", framework: "astro" };
    }

    await replaceBucketPrefixWithDirectory({
      client,
      bucket: storageConfig.bucket,
      localDir: distDir,
      keyPrefix: targetPrefix,
    });

    await writeArtifactBuildMeta({
      client,
      bucket: storageConfig.bucket,
      organizationId: options.organizationId,
      slug: options.slug,
      version: options.version,
      kind: options.kind,
      meta: {
        status: "ready",
        framework: "astro",
        commitHash: options.commitHash,
        startedAt,
        completedAt: new Date().toISOString(),
      },
    });

    return { status: "ready", framework: "astro" };
  } catch (error) {
    const latestMeta = await readArtifactBuildMeta({
      client,
      bucket: storageConfig.bucket,
      organizationId: options.organizationId,
      slug: options.slug,
      version: options.version,
      kind: options.kind,
    });
    if (buildMetaMatchesCommit(latestMeta, options.commitHash)) {
      await writeArtifactBuildMeta({
        client,
        bucket: storageConfig.bucket,
        organizationId: options.organizationId,
        slug: options.slug,
        version: options.version,
        kind: options.kind,
        meta: {
          status: "error",
          framework: "astro",
          commitHash: options.commitHash,
          startedAt,
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
    throw error;
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
}
