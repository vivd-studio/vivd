import axios, { type AxiosInstance } from "axios";

export type GitHubRepoVisibility = "private" | "public" | "internal";

export interface GitHubSyncSettings {
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

export function getGitHubSyncSettings(): GitHubSyncSettings {
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

export class GitHubApiService {
  private createClient(settings: GitHubSyncSettings): AxiosInstance {
    return axios.create({
      baseURL: settings.apiBaseUrl,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${settings.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "vivd",
      },
      timeout: 10_000,
      validateStatus: () => true,
    });
  }

  async repoExists(
    org: string,
    repo: string,
    settings: GitHubSyncSettings,
  ): Promise<boolean> {
    const client = this.createClient(settings);
    const res = await client.get(`/repos/${org}/${repo}`);
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw new Error(
      `GitHub repo lookup failed (${res.status}): ${JSON.stringify(res.data)}`,
    );
  }

  async ensureOrgRepoExists(
    org: string,
    repo: string,
    settings: GitHubSyncSettings,
  ): Promise<void> {
    const exists = await this.repoExists(org, repo, settings);
    if (exists) return;

    const client = this.createClient(settings);
    const res = await client.post(`/orgs/${org}/repos`, {
      name: repo,
      private: settings.visibility !== "public",
      visibility: settings.visibility,
      auto_init: false,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    });

    if (res.status === 201) return;

    // If a concurrent request created it, GitHub returns 422.
    if (res.status === 422) return;

    throw new Error(
      `GitHub repo creation failed (${res.status}): ${JSON.stringify(res.data)}`,
    );
  }
}

export const gitHubApiService = new GitHubApiService();

