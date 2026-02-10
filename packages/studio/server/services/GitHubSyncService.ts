import { spawn } from "node:child_process";

export type GitHubRepoVisibility = "private" | "public" | "internal";

export type GitHubSyncResult =
  | { attempted: false; success: true }
  | { attempted: true; success: true; repo: string; remoteUrl: string }
  | {
      attempted: true;
      success: false;
      error: string;
      repo?: string;
      remoteUrl?: string;
    };

interface GitHubSyncSettings {
  enabled: boolean;
  strict: boolean;
  org: string;
  token: string;
  apiBaseUrl: string;
  gitHost: string;
  remoteName: string;
  visibility: GitHubRepoVisibility;
  repoPrefix: string;
}

function getGitHubSyncSettings(): GitHubSyncSettings {
  const enabled = process.env.GITHUB_SYNC_ENABLED === "true";
  const strict = process.env.GITHUB_SYNC_STRICT === "true";
  const org = process.env.GITHUB_ORG || "";
  const token = process.env.GITHUB_TOKEN || "";
  const apiBaseUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const gitHost = process.env.GITHUB_GIT_HOST || "github.com";
  const remoteName = process.env.GITHUB_REMOTE_NAME || "origin";

  const visibilityRaw = (process.env.GITHUB_REPO_VISIBILITY ||
    "private") as GitHubRepoVisibility;
  const visibility: GitHubRepoVisibility = ["private", "public", "internal"].includes(
    visibilityRaw,
  )
    ? visibilityRaw
    : "private";

  const repoPrefix = process.env.GITHUB_REPO_PREFIX || "";

  return {
    enabled,
    strict,
    org,
    token,
    apiBaseUrl,
    gitHost,
    remoteName,
    visibility,
    repoPrefix,
  };
}

function getTenantId(): string {
  return (process.env.VIVD_TENANT_ID || process.env.TENANT_ID || "default").trim();
}

function buildGitHubRepoName(args: {
  tenantId: string;
  slug: string;
  version: number;
}): string {
  const settings = getGitHubSyncSettings();
  const base = `${args.slug}-v${args.version}`;
  const rawPrefix = settings.repoPrefix.trim();
  const normalizedPrefix = rawPrefix
    ? rawPrefix.endsWith("-")
      ? rawPrefix
      : `${rawPrefix}-`
    : "";
  const withPrefix = normalizedPrefix
    ? `${normalizedPrefix}${base}`
    : `${args.tenantId}-${base}`;
  return withPrefix
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 100);
}

function buildGitHubRemoteUrl(org: string, repo: string, gitHost: string): string {
  return `https://${gitHost}/${org}/${repo}.git`;
}

function getGitHttpAuthHeaderValue(token: string): string {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return `AUTHORIZATION: basic ${basic}`;
}

function sanitizeGitAuthFromMessage(message: string): string {
  return message.replace(
    /http\.extraHeader=AUTHORIZATION:\s*basic\s+[A-Za-z0-9+/=]+/gi,
    "http.extraHeader=AUTHORIZATION: basic <redacted>",
  );
}

async function runGit(options: {
  cwd: string;
  args: string[];
  env?: Record<string, string>;
}): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const proc = spawn("git", options.args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(err);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const out = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
      reject(new Error(out || `git exited with code ${code ?? "unknown"}`));
    });
  });
}

async function ensureSafeDirectory(cwd: string): Promise<void> {
  try {
    await runGit({
      cwd,
      args: ["config", "--global", "--add", "safe.directory", cwd],
    });
  } catch {
    // Ignore: safe.directory may already be set or global config may be unavailable.
  }
}

async function ensureRemoteUrl(cwd: string, remoteName: string, remoteUrl: string): Promise<void> {
  await ensureSafeDirectory(cwd);
  try {
    const res = await runGit({
      cwd,
      args: ["remote", "get-url", remoteName],
    });
    if (res.stdout.trim() === remoteUrl) return;
    await runGit({
      cwd,
      args: ["remote", "set-url", remoteName, remoteUrl],
    });
  } catch {
    await runGit({
      cwd,
      args: ["remote", "add", remoteName, remoteUrl],
    });
  }
}

async function gitWithHttpAuth(cwd: string, token: string, args: string[]): Promise<void> {
  const extraHeader = getGitHttpAuthHeaderValue(token);
  await runGit({
    cwd,
    args: ["-c", `http.extraHeader=${extraHeader}`, ...args],
    env: {
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

async function repoExists(org: string, repo: string, settings: GitHubSyncSettings): Promise<boolean> {
  const res = await fetch(`${settings.apiBaseUrl}/repos/${org}/${repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${settings.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "vivd-studio",
    },
  });

  if (res.status === 200) return true;
  if (res.status === 404) return false;

  const body = await res.text().catch(() => "");
  throw new Error(`GitHub repo lookup failed (${res.status}): ${body}`);
}

async function ensureOrgRepoExists(
  org: string,
  repo: string,
  settings: GitHubSyncSettings,
): Promise<void> {
  const exists = await repoExists(org, repo, settings);
  if (exists) return;

  const res = await fetch(`${settings.apiBaseUrl}/orgs/${org}/repos`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${settings.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "vivd-studio",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: repo,
      private: settings.visibility !== "public",
      visibility: settings.visibility,
      auto_init: false,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    }),
  });

  if (res.status === 201) return;
  if (res.status === 422) return;

  const body = await res.text().catch(() => "");
  throw new Error(`GitHub repo creation failed (${res.status}): ${body}`);
}

export async function syncPushToGitHub(params: {
  cwd: string;
  slug: string;
  version: number;
  tenantId?: string;
}): Promise<GitHubSyncResult> {
  const settings = getGitHubSyncSettings();
  if (!settings.enabled) return { attempted: false, success: true };

  if (!settings.org || !settings.token) {
    const error = "GITHUB_ORG/GITHUB_TOKEN missing";
    if (settings.strict) throw new Error(error);
    return { attempted: true, success: false, error };
  }

  const tenantId = params.tenantId || getTenantId();
  const repoName = buildGitHubRepoName({
    tenantId,
    slug: params.slug,
    version: params.version,
  });
  const remoteUrl = buildGitHubRemoteUrl(settings.org, repoName, settings.gitHost);

  try {
    await ensureSafeDirectory(params.cwd);
    await ensureOrgRepoExists(settings.org, repoName, settings);
    await ensureRemoteUrl(params.cwd, settings.remoteName, remoteUrl);
    await gitWithHttpAuth(params.cwd, settings.token, [
      "push",
      "--tags",
      "-u",
      settings.remoteName,
      "HEAD:main",
    ]);

    return {
      attempted: true,
      success: true,
      repo: `${settings.org}/${repoName}`,
      remoteUrl,
    };
  } catch (error) {
    const msgRaw = error instanceof Error ? error.message : String(error);
    const msg = sanitizeGitAuthFromMessage(msgRaw);
    if (settings.strict) throw error;
    console.warn("GitHub sync push failed:", msg);
    return {
      attempted: true,
      success: false,
      error: msg,
      repo: `${settings.org}/${repoName}`,
      remoteUrl,
    };
  }
}
