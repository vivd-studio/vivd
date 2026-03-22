import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { isIP } from "node:net";
import { db } from "../../db";
import { publishedSite } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import type { GitHubSyncResult } from "../integrations/GitService";
import {
  uploadProjectPublishedToBucket,
} from "../project/ProjectArtifactsService";
import {
  downloadArtifactToDirectory,
  resolvePublishableArtifactState,
} from "../project/ProjectArtifactStateService";
import type { PublishArtifactKind } from "../project/ProjectArtifactStateService";
import { domainService } from "./DomainService";
import { reloadCaddyConfig } from "../system/CaddyAdminService";
import { instanceNetworkSettingsService } from "../system/InstanceNetworkSettingsService";

// Directory where published site files are stored (Caddy reads from here)
const PUBLISHED_DIR = process.env.PUBLISHED_DIR || "/srv/published";
// Directory where Caddy site configs are stored
const CADDY_SITES_DIR = process.env.CADDY_SITES_DIR || "/etc/caddy/sites.d";
const REDIRECTS_MANIFEST_FILENAME = "redirects.json";
const REDIRECT_STATUS_CODES = new Set([301, 302, 307, 308]);
type CaddyTlsMode = "managed" | "off";

type ProjectRedirectRule = {
  fromPath: string;
  to: string;
  statusCode: 301 | 302 | 307 | 308;
  isPrefix: boolean;
};

function parseCaddyTlsMode(value: string | undefined): CaddyTlsMode {
  return value?.trim().toLowerCase() === "managed" ? "managed" : "off";
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return fallback;
  }
}

function isDevelopmentLikeDomain(domain: string): boolean {
  return (
    domain === "localhost" ||
    domain.endsWith(".local") ||
    domain.endsWith(".localhost") ||
    isIP(domain) !== 0 ||
    !domain.includes(".")
  );
}

export function buildPublishedSiteAddressSpec(
  domain: string,
  options?: {
    isDev?: boolean;
    caddyTlsMode?: CaddyTlsMode;
    includeWwwAlias?: boolean;
  },
): string {
  const isDev = options?.isDev ?? isDevelopmentLikeDomain(domain);
  const caddyTlsMode =
    options?.caddyTlsMode ??
    (instanceNetworkSettingsService.getResolvedSettings().tlsMode === "managed"
      ? "managed"
      : parseCaddyTlsMode(process.env.VIVD_CADDY_TLS_MODE));
  const includeWwwAlias =
    options?.includeWwwAlias ??
    parseBooleanEnv(process.env.VIVD_PUBLISH_INCLUDE_WWW_ALIAS, true);

  if (isDev) {
    return `http://${domain}`;
  }

  const addresses = includeWwwAlias ? [domain, `www.${domain}`] : [domain];
  if (caddyTlsMode === "managed") {
    return addresses.join(", ");
  }

  return addresses.map((address) => `http://${address}`).join(", ");
}

export interface PublishResult {
  success: boolean;
  domain: string;
  commitHash: string;
  url: string;
  message: string;
  github?: GitHubSyncResult;
}

export interface PublishedSiteInfo {
  id: string;
  organizationId: string;
  domain: string;
  commitHash: string;
  publishedAt: Date;
  projectSlug: string;
  projectVersion: number;
}

export class PublishConflictError extends Error {
  reason: "build_in_progress" | "artifact_not_ready" | "artifact_changed";

  constructor(
    reason: "build_in_progress" | "artifact_not_ready" | "artifact_changed",
    message: string,
  ) {
    super(message);
    this.reason = reason;
    this.name = "PublishConflictError";
  }
}

/**
 * Service for publishing project versions to custom domains via Caddy.
 */
export class PublishService {
  private activePublishes = new Set<string>();

  private async withPublishLock<T>(
    organizationId: string,
    projectSlug: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `${organizationId}:${projectSlug}`;
    while (this.activePublishes.has(lockKey)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.activePublishes.add(lockKey);

    try {
      return await work();
    } finally {
      this.activePublishes.delete(lockKey);
    }
  }

  /**
   * Normalize domain: strip www., lowercase, trim whitespace, remove port
   */
  normalizeDomain(input: string): string {
    return domainService.normalizeDomain(input);
  }

  /**
   * Validate domain format
   */
  validateDomain(domain: string): { valid: boolean; error?: string } {
    const validation = domainService.validateDomainForRegistry(domain);
    return validation.valid
      ? { valid: true }
      : { valid: false, error: validation.error };
  }

  /**
   * Check if a domain is available (not used by another project)
   */
  async isDomainAvailable(
    domain: string,
    exclude?: { organizationId: string; projectSlug: string }
  ): Promise<boolean> {
    const normalized = this.normalizeDomain(domain);

    const existing = await db
      .select()
      .from(publishedSite)
      .where(eq(publishedSite.domain, normalized))
      .limit(1);

    if (existing.length === 0) {
      return true;
    }

    // If checking for the same project, allow it (republishing)
    if (
      exclude &&
      existing[0].organizationId === exclude.organizationId &&
      existing[0].projectSlug === exclude.projectSlug
    ) {
      return true;
    }

    return false;
  }

  /**
   * Publish a project version to a domain
   */
  async publish(params: {
    organizationId: string;
    projectSlug: string;
    version: number;
    domain: string;
    userId: string;
    expectedCommitHash?: string;
  }): Promise<PublishResult> {
    return await this.withPublishLock(params.organizationId, params.projectSlug, async () => {
      const { organizationId, projectSlug, version, domain, userId, expectedCommitHash } = params;
      const normalizedDomain = this.normalizeDomain(domain);

      // Validate domain format
      const validation = this.validateDomain(normalizedDomain);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const allowlist = await domainService.ensurePublishDomainEnabled({
        organizationId,
        domain: normalizedDomain,
      });
      if (!allowlist.enabled) {
        throw new Error(allowlist.message || "Domain is not enabled for this organization");
      }

      // Check domain availability
      const available = await this.isDomainAvailable(normalizedDomain, {
        organizationId,
        projectSlug,
      });
      if (!available) {
        throw new Error(
          `Domain "${normalizedDomain}" is already in use by another project`,
        );
      }

      // Resolve publish source from bucket artifacts.
      const artifactState = await resolvePublishableArtifactState({
        organizationId,
        slug: projectSlug,
        version,
      });

      if (!artifactState.storageEnabled) {
        throw new Error(
          "Publishing requires object storage configuration (bucket-first publish).",
        );
      }

      if (artifactState.readiness === "build_in_progress") {
        throw new PublishConflictError(
          "build_in_progress",
          "Build in progress. Publish is blocked until artifact is ready.",
        );
      }

      if (artifactState.readiness === "artifact_not_ready") {
        throw new PublishConflictError(
          "artifact_not_ready",
          artifactState.error || "Artifact is not ready for publish.",
        );
      }

      if (artifactState.readiness === "not_found" || !artifactState.sourceKind) {
        throw new Error("No publishable artifact found for this project version.");
      }

      if (expectedCommitHash && artifactState.commitHash !== expectedCommitHash) {
        throw new PublishConflictError(
          "artifact_changed",
          "The publishable artifact changed. Refresh status and try again.",
        );
      }

      const publishedPath = path.join(PUBLISHED_DIR, organizationId, projectSlug);
      const stagingDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `vivd-publish-${projectSlug}-`),
      );
      let redirectRules: ProjectRedirectRule[] = [];

      try {
        // Hydrate artifact from bucket into a temporary staging directory.
        const downloadResult = await downloadArtifactToDirectory({
          organizationId,
          slug: projectSlug,
          version,
          kind: artifactState.sourceKind,
          destinationDir: stagingDir,
        });
        if (!downloadResult.downloaded) {
          throw new Error("Artifact download failed or returned no files.");
        }

        if (fs.existsSync(publishedPath)) {
          fs.rmSync(publishedPath, { recursive: true, force: true });
        }
        this.copyDirectory(stagingDir, publishedPath);
        redirectRules = await this.loadProjectRedirectRules({
          organizationId,
          projectSlug,
          version,
          publishSourceKind: artifactState.sourceKind,
          publishArtifactDir: stagingDir,
        });
      } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }

      const commitHash = artifactState.commitHash || "unknown";

      // Keep published artifact in bucket in sync (best-effort).
      await uploadProjectPublishedToBucket({
        organizationId,
        localDir: publishedPath,
        slug: projectSlug,
        version,
        meta: {
          status: "ready",
          framework: artifactState.framework,
          commitHash,
          completedAt: new Date().toISOString(),
        },
      }).catch(() => {});

      // Read existing publish record before reloading Caddy so we can remove stale domain config.
      const existingRecord = await db
        .select()
        .from(publishedSite)
        .where(
          and(
            eq(publishedSite.organizationId, organizationId),
            eq(publishedSite.projectSlug, projectSlug),
          ),
        )
        .limit(1);

      if (existingRecord.length > 0 && existingRecord[0].domain !== normalizedDomain) {
        this.removeCaddyConfig(existingRecord[0].domain);
      }

      await this.generateCaddyConfig(
        normalizedDomain,
        organizationId,
        projectSlug,
        redirectRules,
      );
      await this.reloadCaddy();

      const now = new Date();
      const recordId =
        existingRecord.length > 0 ? existingRecord[0].id : crypto.randomUUID();

      if (existingRecord.length > 0) {
        await db
          .update(publishedSite)
          .set({
            domain: normalizedDomain,
            projectVersion: version,
            commitHash,
            publishedAt: now,
            publishedById: userId,
          })
          .where(eq(publishedSite.id, existingRecord[0].id));
      } else {
        await db.insert(publishedSite).values({
          id: recordId,
          organizationId,
          projectSlug,
          projectVersion: version,
          domain: normalizedDomain,
          commitHash,
          publishedAt: now,
          publishedById: userId,
        });
      }

      const urlScheme = this.isDevDomain(normalizedDomain) ? "http" : "https";

      return {
        success: true,
        domain: normalizedDomain,
        commitHash,
        url: `${urlScheme}://${normalizedDomain}`,
        message: `Published to ${normalizedDomain}`,
      };
    });
  }

  /**
   * Unpublish a project (remove from Caddy and optionally delete files)
   */
  async unpublish(
    organizationId: string,
    projectSlug: string,
    deleteFiles = true,
  ): Promise<void> {
    const existing = await db
      .select()
      .from(publishedSite)
      .where(
        and(
          eq(publishedSite.organizationId, organizationId),
          eq(publishedSite.projectSlug, projectSlug),
        ),
      )
      .limit(1);

    if (existing.length === 0) throw new Error("Project is not published");

    const { domain } = existing[0];

    // Remove Caddy config
    this.removeCaddyConfig(domain);

    // Reload Caddy
    await this.reloadCaddy();

    // Delete database record
    await db.delete(publishedSite).where(eq(publishedSite.id, existing[0].id));

    // Optionally delete published files
    if (deleteFiles) {
      const publishedPath = path.join(PUBLISHED_DIR, organizationId, projectSlug);
      if (fs.existsSync(publishedPath)) {
        fs.rmSync(publishedPath, { recursive: true, force: true });
      }
    }
  }

  /**
   * Get all published sites as a map keyed by project slug
   */
  async getAllPublishedSites(): Promise<Map<string, PublishedSiteInfo>> {
    const results = await db.select().from(publishedSite);

    const map = new Map<string, PublishedSiteInfo>();
    for (const record of results) {
      map.set(`${record.organizationId}:${record.projectSlug}`, {
        id: record.id,
        organizationId: record.organizationId,
        domain: record.domain,
        commitHash: record.commitHash,
        publishedAt: record.publishedAt,
        projectSlug: record.projectSlug,
        projectVersion: record.projectVersion,
      });
    }
    return map;
  }

  async getPublishedSitesForOrganization(
    organizationId: string,
  ): Promise<Map<string, PublishedSiteInfo>> {
    const results = await db
      .select()
      .from(publishedSite)
      .where(eq(publishedSite.organizationId, organizationId));

    const map = new Map<string, PublishedSiteInfo>();
    for (const record of results) {
      map.set(record.projectSlug, {
        id: record.id,
        organizationId: record.organizationId,
        domain: record.domain,
        commitHash: record.commitHash,
        publishedAt: record.publishedAt,
        projectSlug: record.projectSlug,
        projectVersion: record.projectVersion,
      });
    }
    return map;
  }

  /**
   * Get published info for a project
   */
  async getPublishedInfo(
    organizationId: string,
    projectSlug: string,
  ): Promise<PublishedSiteInfo | null> {
    const result = await db
      .select()
      .from(publishedSite)
      .where(
        and(
          eq(publishedSite.organizationId, organizationId),
          eq(publishedSite.projectSlug, projectSlug),
        ),
      )
      .limit(1);

    if (result.length === 0) return null;

    const record = result[0];
    return {
      id: record.id,
      organizationId: record.organizationId,
      domain: record.domain,
      commitHash: record.commitHash,
      publishedAt: record.publishedAt,
      projectSlug: record.projectSlug,
      projectVersion: record.projectVersion,
    };
  }

  async syncGeneratedCaddyConfigs(): Promise<number> {
    const records = await db.select().from(publishedSite);
    if (records.length === 0) return 0;

    for (const record of records) {
      const publishedPath = path.join(
        PUBLISHED_DIR,
        record.organizationId,
        record.projectSlug,
      );

      let redirectRules: ProjectRedirectRule[] = [];
      try {
        redirectRules = this.readRedirectRulesFromDirectory(publishedPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[Publish] Failed to reload redirects for ${record.domain} from ${publishedPath}: ${message}`,
        );
      }

      await this.generateCaddyConfig(
        record.domain,
        record.organizationId,
        record.projectSlug,
        redirectRules,
      );
    }

    await this.reloadCaddy();
    return records.length;
  }

  /**
   * Copy directory recursively, excluding git files
   */
  private copyDirectory(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      // Skip private/internal files and folders (publish should only include public site files)
      // Allow `.well-known/` for common web conventions (e.g. security.txt).
      if (
        entry.name === ".git" ||
        entry.name === ".vivd" ||
        entry.name === ".vivd-working-commit" ||
        (entry.name.startsWith(".") && entry.name !== ".well-known")
      ) {
        continue;
      }

      const st = fs.lstatSync(srcPath);
      if (st.isSymbolicLink()) {
        console.warn(`[Publish] Skipping symlink: ${srcPath}`);
        continue;
      }

      if (st.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
        continue;
      }

      if (st.isFile()) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Check if a domain is a development domain (no TLS needed)
   */
  isDevDomain(domain: string): boolean {
    return isDevelopmentLikeDomain(domain);
  }

  /**
   * Load project redirects from redirects.json.
   *
   * For Astro publishes, the published artifact is the built preview output.
   * If redirects are not present there, fall back to source artifact.
   */
  private async loadProjectRedirectRules(options: {
    organizationId: string;
    projectSlug: string;
    version: number;
    publishSourceKind: PublishArtifactKind;
    publishArtifactDir: string;
  }): Promise<ProjectRedirectRule[]> {
    const fromPublishArtifact = this.readRedirectRulesFromDirectory(
      options.publishArtifactDir,
    );
    if (fromPublishArtifact.length > 0) return fromPublishArtifact;

    if (options.publishSourceKind !== "preview") {
      return [];
    }

    const sourceStagingDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `vivd-publish-source-${options.projectSlug}-`),
    );
    try {
      const sourceDownload = await downloadArtifactToDirectory({
        organizationId: options.organizationId,
        slug: options.projectSlug,
        version: options.version,
        kind: "source",
        destinationDir: sourceStagingDir,
      });
      if (!sourceDownload.downloaded) return [];
      return this.readRedirectRulesFromDirectory(sourceStagingDir);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith(`Invalid ${REDIRECTS_MANIFEST_FILENAME}`)
      ) {
        throw error;
      }
      console.warn(
        `[Publish] Could not load ${REDIRECTS_MANIFEST_FILENAME} from source artifact for ${options.organizationId}/${options.projectSlug}:`,
        error,
      );
      return [];
    } finally {
      fs.rmSync(sourceStagingDir, { recursive: true, force: true });
    }
  }

  /**
   * Parse redirects.json from an artifact directory.
   *
   * Supported formats:
   * - { "redirects": [{ "from": "/old", "to": "/new", "status": 308 }] }
   * - [{ "from": "/old", "to": "/new", "status": 308 }]
   */
  private readRedirectRulesFromDirectory(
    artifactDir: string,
  ): ProjectRedirectRule[] {
    const manifestPath = path.join(artifactDir, REDIRECTS_MANIFEST_FILENAME);
    if (!fs.existsSync(manifestPath)) return [];

    let parsed: unknown;
    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      parsed = JSON.parse(raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid ${REDIRECTS_MANIFEST_FILENAME}: failed to parse JSON (${reason})`,
      );
    }

    const redirectEntries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { redirects?: unknown }).redirects)
        ? (parsed as { redirects: unknown[] }).redirects
        : null;

    if (!redirectEntries) {
      throw new Error(
        `Invalid ${REDIRECTS_MANIFEST_FILENAME}: expected an array or a top-level "redirects" array`,
      );
    }

    const rules: ProjectRedirectRule[] = [];
    for (const [index, entry] of redirectEntries.entries()) {
      if (!entry || typeof entry !== "object") {
        throw new Error(
          `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} must be an object`,
        );
      }

      const record = entry as Record<string, unknown>;
      const rawFrom = this.pickFirstString(record, ["from", "source", "path"]);
      const rawTo = this.pickFirstString(record, ["to", "destination", "target"]);
      const rawStatus = record.status ?? record.statusCode;

      if (!rawFrom) {
        throw new Error(
          `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} is missing "from"`,
        );
      }
      if (!rawTo) {
        throw new Error(
          `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} is missing "to"`,
        );
      }

      const fromPath = rawFrom.trim();
      const to = rawTo.trim();
      if (!fromPath.startsWith("/")) {
        throw new Error(
          `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} "from" must start with "/"`,
        );
      }
      if (
        !to.startsWith("/") &&
        !to.startsWith("http://") &&
        !to.startsWith("https://")
      ) {
        throw new Error(
          `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} "to" must be a path or absolute URL`,
        );
      }
      if (!this.isSafeCaddyToken(fromPath)) {
        throw new Error(
          `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} has unsupported characters in "from"`,
        );
      }
      if (!this.isSafeCaddyToken(to)) {
        throw new Error(
          `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} has unsupported characters in "to"`,
        );
      }

      const isPrefix = fromPath.endsWith("*");
      if (isPrefix) {
        if (!fromPath.endsWith("/*") || fromPath.slice(0, -1).includes("*")) {
          throw new Error(
            `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} wildcard "from" must end with "/*"`,
          );
        }
      } else if (fromPath.includes("*")) {
        throw new Error(
          `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} wildcard is only supported at the end as "/*"`,
        );
      }
      const toWildcardCount = (to.match(/\*/g) || []).length;
      if (isPrefix) {
        if (toWildcardCount > 1) {
          throw new Error(
            `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} "to" supports at most one "*" placeholder`,
          );
        }
      } else if (toWildcardCount > 0) {
        throw new Error(
          `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} "to" wildcard is only allowed when "from" ends with "/*"`,
        );
      }
      if (
        fromPath === "/*" ||
        fromPath === "/vivd-studio" ||
        fromPath.startsWith("/vivd-studio/")
      ) {
        throw new Error(
          `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} cannot target Studio routes`,
        );
      }

      let statusCode: 301 | 302 | 307 | 308 = 308;
      if (rawStatus !== undefined) {
        const statusNum =
          typeof rawStatus === "number" ? rawStatus : Number(String(rawStatus));
        if (
          !Number.isInteger(statusNum) ||
          !REDIRECT_STATUS_CODES.has(statusNum)
        ) {
          throw new Error(
            `Invalid ${REDIRECTS_MANIFEST_FILENAME}: redirect #${index + 1} status must be one of 301, 302, 307, 308`,
          );
        }
        statusCode = statusNum as 301 | 302 | 307 | 308;
      }

      rules.push({
        fromPath,
        to,
        statusCode,
        isPrefix,
      });
    }

    return rules;
  }

  private pickFirstString(
    record: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return null;
  }

  private isSafeCaddyToken(value: string): boolean {
    return value.length > 0 && !/[\s\x00-\x1F\x7F]/.test(value);
  }

  private escapeRegexLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private buildRedirectCaddyBlocks(rules: ProjectRedirectRule[]): string {
    if (rules.length === 0) return "";

    const blocks = rules.map((rule, index) => {
      const matcherName = `vivd_redirect_${index}`;

      if (!rule.isPrefix) {
        return `    @${matcherName} path ${rule.fromPath}
    handle @${matcherName} {
        redir * ${rule.to} ${rule.statusCode}
    }`;
      }

      const prefix = rule.fromPath.slice(0, -1);
      const regex = `^${this.escapeRegexLiteral(prefix)}(.*)$`;
      const wildcardTarget = `{re.${matcherName}.1}`;
      const destination = rule.to.includes("*")
        ? rule.to.replace("*", wildcardTarget)
        : rule.to;

      return `    @${matcherName} path_regexp ${matcherName} ${regex}
    handle @${matcherName} {
        redir * ${destination} ${rule.statusCode}
    }`;
    });

    return `    # Project redirects from ${REDIRECTS_MANIFEST_FILENAME}
${blocks.join("\n\n")}
`;
  }

  /**
   * Generate Caddy config snippet for a domain
   */
  private async generateCaddyConfig(
    domain: string,
    organizationId: string,
    projectSlug: string,
    redirectRules: ProjectRedirectRule[] = [],
  ): Promise<void> {
    // Ensure Caddy sites directory exists
    if (!fs.existsSync(CADDY_SITES_DIR)) {
      fs.mkdirSync(CADDY_SITES_DIR, { recursive: true });
    }

    const isDev = this.isDevDomain(domain);
    const domainSpec = buildPublishedSiteAddressSpec(domain, { isDev });

    // Determine frontend port based on environment
    // In development (NODE_ENV=development), frontend runs Vite on 5173
    // In production, frontend runs nginx on 80
    const frontendPort = process.env.NODE_ENV === "development" ? "5173" : "80";

    // Check if the site has a custom 404.html
    const publishedPath = path.join(PUBLISHED_DIR, organizationId, projectSlug);
    const hasCustom404 = fs.existsSync(path.join(publishedPath, "404.html"));

    // Prepare error handler block
    let errorHandlerBlock = "";

    if (hasCustom404) {
      // Use site's custom 404
      errorHandlerBlock = `
    # Custom 404 handling: use site's 404.html
	    handle_errors {
	        @404 expression {err.status_code} == 404
	        handle @404 {
	            root * ${publishedPath}
	            rewrite * /404.html
	            file_server {
	                status {err.status_code}
	            }
        }
    }`;
    } else {
      // Use system default 404
      errorHandlerBlock = `
    # Fallback 404 handling: use default 404 page
    handle_errors {
        @404 expression {err.status_code} == 404
        handle @404 {
            root * /srv/default
            rewrite * /default-404.html
            file_server {
                status {err.status_code}
            }
        }
    }`;
    }

    // Generate config with a matcher to exclude /vivd-studio routes
    // This ensures the main Caddyfile handles studio routes even when a site is published
    const redirectRulesBlock = this.buildRedirectCaddyBlocks(redirectRules);
    const config = `# Auto-generated by Vivd for ${domain}
${domainSpec} {
${redirectRulesBlock}
    # Matcher to exclude Vivd runtime routes
    @notVivdRuntime not path /vivd-studio /vivd-studio/* /_studio /_studio/* /plugins /plugins/* /email/v1/feedback /email/v1/feedback/*

    # Active studio runtime routes
    import /etc/caddy/runtime.d/*.caddy

    # Serve published site only for non-runtime paths
    handle @notVivdRuntime {
	        root * ${publishedPath}
	        try_files {path} {path}.html {path}/index.html
	        file_server {
	            hide .vivd .git .vivd-working-commit
	        }
    }
${errorHandlerBlock}

    # Studio API - proxy to backend
    handle /vivd-studio/api/* {
        reverse_proxy backend:3000
    }

    # Same-host plugin runtime
    handle /plugins/* {
        reverse_proxy backend:3000
    }

    # Same-host email feedback endpoints
    handle /email/v1/feedback/* {
        reverse_proxy backend:3000
    }

    # Studio frontend - proxy to frontend (handles /vivd-studio and /vivd-studio/*)
    handle /vivd-studio* {
        reverse_proxy frontend:${frontendPort}
    }
}
`;

    // Write config file (use domain as filename, sanitized)
    const filename = domain.replace(/\./g, "-") + ".caddy";
    const configPath = path.join(CADDY_SITES_DIR, filename);
    fs.writeFileSync(configPath, config, "utf-8");
  }

  /**
   * Remove Caddy config for a domain
   */
  private removeCaddyConfig(domain: string): void {
    const filename = domain.replace(/\./g, "-") + ".caddy";
    const configPath = path.join(CADDY_SITES_DIR, filename);

    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  }

  private async reloadCaddy(): Promise<void> {
    await reloadCaddyConfig();
  }
}

// Export singleton instance
export const publishService = new PublishService();
