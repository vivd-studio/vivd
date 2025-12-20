import * as fs from "fs";
import * as path from "path";
import { db } from "../db";
import { publishedSite } from "../db/schema";
import { eq } from "drizzle-orm";
import { gitService } from "./GitService";
import { getVersionDir } from "../generator/versionUtils";

// Directory where published site files are stored (Caddy reads from here)
const PUBLISHED_DIR = process.env.PUBLISHED_DIR || "/srv/published";
// Directory where Caddy site configs are stored
const CADDY_SITES_DIR = process.env.CADDY_SITES_DIR || "/etc/caddy/sites.d";
// Caddy admin API URL for reloading config
const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || "http://caddy:2019";

export interface PublishResult {
  success: boolean;
  domain: string;
  commitHash: string;
  url: string;
  message: string;
}

export interface PublishedSiteInfo {
  id: string;
  domain: string;
  commitHash: string;
  publishedAt: Date;
  projectSlug: string;
  projectVersion: number;
}

/**
 * Service for publishing project versions to custom domains via Caddy.
 */
export class PublishService {
  /**
   * Normalize domain: strip www., lowercase, trim whitespace, remove port
   */
  normalizeDomain(input: string): string {
    let domain = input.toLowerCase().trim();

    // Remove protocol if present
    domain = domain.replace(/^https?:\/\//, "");

    // Remove trailing slash and path
    domain = domain.split("/")[0];

    // Remove port number if present (e.g., localhost:5173 -> localhost)
    domain = domain.split(":")[0];

    // Remove www. prefix
    if (domain.startsWith("www.")) {
      domain = domain.substring(4);
    }

    return domain;
  }

  /**
   * Validate domain format
   */
  validateDomain(domain: string): { valid: boolean; error?: string } {
    if (!domain || domain.length < 1) {
      return { valid: false, error: "Domain is required" };
    }

    // Allow localhost and *.local for development
    if (domain === "localhost" || domain.endsWith(".local")) {
      return { valid: true };
    }

    // Basic domain format validation - allows single-part or multi-part domains
    // Single part: test, mysite (for /etc/hosts entries)
    // Multi part: example.com, app.example.com
    const domainRegex =
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
    if (!domainRegex.test(domain)) {
      return { valid: false, error: "Invalid domain format" };
    }

    // Check for reserved domains (IP addresses)
    const reserved = ["127.0.0.1", "0.0.0.0"];
    if (reserved.includes(domain)) {
      return {
        valid: false,
        error: "IP addresses are not supported, use a domain name",
      };
    }

    return { valid: true };
  }

  /**
   * Check if a domain is available (not used by another project)
   */
  async isDomainAvailable(
    domain: string,
    excludeProjectSlug?: string
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
    if (excludeProjectSlug && existing[0].projectSlug === excludeProjectSlug) {
      return true;
    }

    return false;
  }

  /**
   * Publish a project version to a domain
   */
  async publish(params: {
    projectSlug: string;
    version: number;
    domain: string;
    userId: string;
  }): Promise<PublishResult> {
    const { projectSlug, version, domain, userId } = params;
    const normalizedDomain = this.normalizeDomain(domain);

    // Validate domain format
    const validation = this.validateDomain(normalizedDomain);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Check domain availability
    const available = await this.isDomainAvailable(
      normalizedDomain,
      projectSlug
    );
    if (!available) {
      throw new Error(
        `Domain "${normalizedDomain}" is already in use by another project`
      );
    }

    // Get project version directory
    const versionDir = getVersionDir(projectSlug, version);
    if (!fs.existsSync(versionDir)) {
      throw new Error("Project version not found");
    }

    // Create a snapshot (git commit) for publishing
    const commitMessage = `Published to ${normalizedDomain}`;
    const saveResult = await gitService.save(versionDir, commitMessage);
    const commitHash = saveResult.hash;

    // Create published directory structure
    const publishedPath = path.join(PUBLISHED_DIR, projectSlug);

    // Remove old published files if they exist
    if (fs.existsSync(publishedPath)) {
      fs.rmSync(publishedPath, { recursive: true, force: true });
    }

    // Copy files to published directory
    this.copyDirectory(versionDir, publishedPath);

    // Generate Caddy config for this domain
    await this.generateCaddyConfig(normalizedDomain, projectSlug);

    // Reload Caddy to apply new config
    await this.reloadCaddy();

    // Upsert database record
    const existingRecord = await db
      .select()
      .from(publishedSite)
      .where(eq(publishedSite.projectSlug, projectSlug))
      .limit(1);

    const now = new Date();
    const recordId =
      existingRecord.length > 0 ? existingRecord[0].id : crypto.randomUUID();

    if (existingRecord.length > 0) {
      // Update existing record
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

      // If domain changed, remove old Caddy config
      if (existingRecord[0].domain !== normalizedDomain) {
        this.removeCaddyConfig(existingRecord[0].domain);
      }
    } else {
      // Insert new record
      await db.insert(publishedSite).values({
        id: recordId,
        projectSlug,
        projectVersion: version,
        domain: normalizedDomain,
        commitHash,
        publishedAt: now,
        publishedById: userId,
      });
    }

    // Determine URL scheme based on domain type
    const urlScheme = this.isDevDomain(normalizedDomain) ? "http" : "https";

    return {
      success: true,
      domain: normalizedDomain,
      commitHash,
      url: `${urlScheme}://${normalizedDomain}`,
      message: `Published to ${normalizedDomain}`,
    };
  }

  /**
   * Unpublish a project (remove from Caddy and optionally delete files)
   */
  async unpublish(projectSlug: string, deleteFiles = true): Promise<void> {
    const existing = await db
      .select()
      .from(publishedSite)
      .where(eq(publishedSite.projectSlug, projectSlug))
      .limit(1);

    if (existing.length === 0) {
      throw new Error("Project is not published");
    }

    const { domain } = existing[0];

    // Remove Caddy config
    this.removeCaddyConfig(domain);

    // Reload Caddy
    await this.reloadCaddy();

    // Delete database record
    await db
      .delete(publishedSite)
      .where(eq(publishedSite.projectSlug, projectSlug));

    // Optionally delete published files
    if (deleteFiles) {
      const publishedPath = path.join(PUBLISHED_DIR, projectSlug);
      if (fs.existsSync(publishedPath)) {
        fs.rmSync(publishedPath, { recursive: true, force: true });
      }
    }
  }

  /**
   * Get published info for a project
   */
  async getPublishedInfo(
    projectSlug: string
  ): Promise<PublishedSiteInfo | null> {
    const result = await db
      .select()
      .from(publishedSite)
      .where(eq(publishedSite.projectSlug, projectSlug))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const record = result[0];
    return {
      id: record.id,
      domain: record.domain,
      commitHash: record.commitHash,
      publishedAt: record.publishedAt,
      projectSlug: record.projectSlug,
      projectVersion: record.projectVersion,
    };
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

      // Skip git-related files and our marker file
      if (entry.name === ".git" || entry.name === ".vivd-working-commit") {
        continue;
      }

      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Check if a domain is a development domain (no TLS needed)
   */
  isDevDomain(domain: string): boolean {
    return (
      domain === "localhost" ||
      domain.endsWith(".local") ||
      domain.endsWith(".localhost") ||
      // Single-label domains (no dots) are typically local
      !domain.includes(".")
    );
  }

  /**
   * Generate Caddy config snippet for a domain
   */
  private async generateCaddyConfig(
    domain: string,
    projectSlug: string
  ): Promise<void> {
    // Ensure Caddy sites directory exists
    if (!fs.existsSync(CADDY_SITES_DIR)) {
      fs.mkdirSync(CADDY_SITES_DIR, { recursive: true });
    }

    // Always use http:// prefix to prevent Caddy from trying to handle TLS
    // TLS is terminated by the external load balancer in production
    const isDev = this.isDevDomain(domain);
    // For dev domains, no www prefix (www.localhost is invalid)
    // For production domains, include www variant
    const domainSpec = isDev
      ? `http://${domain}`
      : `http://${domain}, http://www.${domain}`;

    // Determine frontend port based on environment
    // In development (NODE_ENV=development), frontend runs Vite on 5173
    // In production, frontend runs nginx on 80
    const frontendPort = process.env.NODE_ENV === "development" ? "5173" : "80";

    // Check if the site has a custom 404.html
    const publishedPath = path.join(PUBLISHED_DIR, projectSlug);
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
            root * /srv/published/${projectSlug}
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
    const config = `# Auto-generated by Vivd for ${domain}
${domainSpec} {
    # Matcher to exclude vivd-studio paths
    @notVivdStudio not path /vivd-studio /vivd-studio/*

    # Serve published site only for non-studio paths
    handle @notVivdStudio {
        root * /srv/published/${projectSlug}
        try_files {path} {path}/index.html
        file_server
    }
${errorHandlerBlock}

    # Studio API - proxy to backend
    handle /vivd-studio/api/* {
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

  /**
   * Trigger Caddy to reload its configuration by posting the Caddyfile
   */
  private async reloadCaddy(): Promise<void> {
    try {
      // Read the Caddyfile content - Caddy will process imports
      const caddyfilePath = "/etc/caddy/Caddyfile";
      let caddyfileContent: string;

      try {
        caddyfileContent = fs.readFileSync(caddyfilePath, "utf-8");
      } catch {
        // In development without Caddy, the file won't exist
        console.warn("Caddyfile not found, skipping reload");
        return;
      }

      // Use Caddy's admin API with Caddyfile content
      // The Content-Type: text/caddyfile tells Caddy to adapt the Caddyfile to JSON
      const response = await fetch(`${CADDY_ADMIN_URL}/load`, {
        method: "POST",
        headers: {
          "Content-Type": "text/caddyfile",
        },
        body: caddyfileContent,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Caddy reload returned ${response.status}: ${errorText}`);
      } else {
        console.log("Caddy configuration reloaded successfully");
      }
    } catch (error) {
      // In development, Caddy might not be running
      console.warn(
        "Could not reload Caddy (this is normal in development):",
        error
      );
    }
  }
}

// Export singleton instance
export const publishService = new PublishService();
