import crypto from "node:crypto";
import dns from "node:dns/promises";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { domain as domainTable, organization, publishedSite } from "../../db/schema";

export const RESERVED_ORG_SLUG_LABELS = [
  "app",
  "www",
  "api",
  "docs",
  "admin",
  "root",
  "default",
  "static",
  "cdn",
  "status",
] as const;

const RESERVED_ORG_SLUG_SET: ReadonlySet<string> = new Set(RESERVED_ORG_SLUG_LABELS);

export type DomainType = "managed_subdomain" | "custom_domain";
export type DomainUsage = "tenant_host" | "publish_target";
export type DomainStatus = "active" | "disabled" | "pending_verification";
export type DomainVerificationMethod = "dns_txt" | "http_file";
export type HostKind =
  | "control_plane_host"
  | "tenant_host"
  | "published_domain"
  | "unknown";

export interface TenantRoutingConfig {
  enabled: boolean;
  tenantBaseDomain: string | null;
  controlPlaneHost: string | null;
}

export interface ResolvedHost {
  requestHost: string | null;
  requestDomain: string | null;
  hostKind: HostKind;
  hostOrganizationId: string | null;
  hostOrganizationSlug: string | null;
  isSuperAdminHost: boolean;
  canSelectOrganization: boolean;
}

type DomainVerificationResult = {
  verified: boolean;
  method: DomainVerificationMethod | null;
  detail: string;
};

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return defaultValue;
}

function ensureAsciiDomain(value: string): boolean {
  return /^[\x00-\x7F]+$/.test(value);
}

const DEFAULT_PUBLIC_PLUGIN_API_HOST = "api.vivd.studio";
const DEFAULT_DOCS_HOST = "docs.vivd.studio";

export function normalizeHostname(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return "";

  let parsedHost = trimmed;
  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      parsedHost = new URL(trimmed).hostname.toLowerCase();
    } else {
      parsedHost = new URL(`http://${trimmed}`).hostname.toLowerCase();
    }
  } catch {
    parsedHost = trimmed.split(",")[0]?.trim().toLowerCase() || "";
  }

  const noPort = parsedHost.split(":")[0] || "";
  if (noPort.startsWith("www.")) return noPort.slice("www.".length);
  return noPort;
}

export function normalizeDomainInput(input: string): string {
  return normalizeHostname(input.split("/")[0] ?? "");
}

export function validateOrganizationSlug(slug: string): { valid: boolean; error?: string } {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return { valid: false, error: "Organization slug is required" };
  if (RESERVED_ORG_SLUG_SET.has(normalized)) {
    return {
      valid: false,
      error: `Organization slug "${normalized}" is reserved`,
    };
  }
  return { valid: true };
}

export class DomainService {
  getPublicPluginApiHost(): string {
    const configured =
      this.getEnvHostname(process.env.VIVD_PUBLIC_PLUGIN_API_HOST) ??
      this.getEnvHostname(DEFAULT_PUBLIC_PLUGIN_API_HOST);
    return configured || DEFAULT_PUBLIC_PLUGIN_API_HOST;
  }

  getDocsHost(): string {
    const configured =
      this.getEnvHostname(process.env.VIVD_DOCS_HOST) ?? this.getEnvHostname(DEFAULT_DOCS_HOST);
    return configured || DEFAULT_DOCS_HOST;
  }

  normalizeHost(value: string): string {
    return normalizeHostname(value);
  }

  /**
   * Infer the tenant base domain from a request host so we can prefer the
   * matching managed tenant host when multiple are active (local/dev setups).
   *
   * Examples:
   * - "localhost" -> "localhost"
   * - "acme.localhost" -> "localhost"
   * - "app.127.0.0.1.nip.io" -> "127.0.0.1.nip.io"
   * - "acme.vivd.studio" -> "vivd.studio"
   */
  inferTenantBaseDomainFromHost(hostname: string | null): string | null {
    if (!hostname) return null;
    const normalized = this.normalizeHost(hostname);
    if (!normalized) return null;

    if (normalized === "localhost" || normalized.endsWith(".localhost")) {
      return "localhost";
    }

    // Don't treat bare IPv4 addresses as base domains (they can't have subdomains).
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) {
      return null;
    }

    const firstDot = normalized.indexOf(".");
    if (firstDot === -1) return null;
    const base = normalized.slice(firstDot + 1).trim();
    return base || null;
  }

  normalizeDomain(value: string): string {
    return normalizeDomainInput(value);
  }

  getEnvHostname(value: string | undefined): string | null {
    if (!value) return null;
    const normalized = normalizeHostname(value);
    return normalized || null;
  }

  getTenantRoutingConfig(): TenantRoutingConfig {
    const enabled = parseBooleanEnv(process.env.TENANT_DOMAIN_ROUTING_ENABLED, true);
    const tenantBaseDomain =
      this.getEnvHostname(process.env.TENANT_BASE_DOMAIN) ??
      this.getEnvHostname(process.env.DOMAIN);
    const controlPlaneHost =
      this.getEnvHostname(process.env.CONTROL_PLANE_HOST) ??
      this.getEnvHostname(process.env.DOMAIN) ??
      "localhost";

    return {
      enabled,
      tenantBaseDomain: tenantBaseDomain || null,
      controlPlaneHost: controlPlaneHost || null,
    };
  }

  /**
   * Pick a control-plane host that is reachable from the current local host setup.
   * If you're running on `*.localhost`, prefer `localhost` even if env points at
   * a nip.io-based host (common when switching between local DNS strategies).
   */
  getControlPlaneHostForRequest(requestDomain: string | null): string | null {
    const routing = this.getTenantRoutingConfig();
    const preferredBaseDomain = this.inferTenantBaseDomainFromHost(requestDomain);
    if (preferredBaseDomain === "localhost") {
      const configured = routing.controlPlaneHost
        ? this.normalizeHost(routing.controlPlaneHost)
        : null;
      if (configured && configured.endsWith(".localhost")) {
        return configured;
      }
      return "localhost";
    }
    return routing.controlPlaneHost;
  }

  getSuperAdminHosts(): Set<string> {
    const hosts = new Set<string>();

    const raw = process.env.SUPERADMIN_HOSTS?.trim();
    if (raw) {
      raw
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean)
        .forEach((h) => {
          const host = this.getEnvHostname(h) ?? h.toLowerCase();
          const normalized = this.normalizeHost(host);
          if (normalized) hosts.add(normalized);
        });
    } else {
      const domainHost = this.getEnvHostname(process.env.DOMAIN) ?? "localhost";
      hosts.add(this.normalizeHost(domainHost));
      hosts.add("localhost");
      hosts.add("127.0.0.1");
    }

    return hosts;
  }

  isSuperAdminHost(hostname: string | null): boolean {
    if (!hostname) return false;
    const normalized = this.normalizeHost(hostname);
    if (!normalized) return false;
    return this.getSuperAdminHosts().has(normalized);
  }

  buildManagedTenantHost(orgSlug: string): string | null {
    const config = this.getTenantRoutingConfig();
    if (!config.tenantBaseDomain) return null;
    return `${orgSlug}.${config.tenantBaseDomain}`;
  }

  isReservedOrgSlug(slug: string): boolean {
    return RESERVED_ORG_SLUG_SET.has(slug.trim().toLowerCase());
  }

  async ensureManagedTenantDomainForOrganization(options: {
    organizationId: string;
    organizationSlug: string;
    createdById?: string;
  }): Promise<void> {
    const managedHost = this.buildManagedTenantHost(options.organizationSlug);
    if (!managedHost) return;

    const existing = await db.query.domain.findFirst({
      where: eq(domainTable.domain, managedHost),
      columns: {
        id: true,
        organizationId: true,
      },
    });

    if (existing && existing.organizationId !== options.organizationId) {
      throw new Error(
        `Managed tenant host "${managedHost}" is already assigned to another organization`,
      );
    }

    if (!existing) {
      await db.insert(domainTable).values({
        id: crypto.randomUUID(),
        domain: managedHost,
        organizationId: options.organizationId,
        type: "managed_subdomain",
        usage: "tenant_host",
        status: "active",
        verificationMethod: null,
        verificationToken: null,
        verifiedAt: new Date(),
        createdById: options.createdById ?? null,
      });
    }
  }

  async ensureManagedTenantDomainsForExistingOrganizations(): Promise<void> {
    const config = this.getTenantRoutingConfig();
    if (!config.tenantBaseDomain) return;

    const orgs = await db.query.organization.findMany({
      columns: { id: true, slug: true },
    });

    for (const org of orgs) {
      await this.ensureManagedTenantDomainForOrganization({
        organizationId: org.id,
        organizationSlug: org.slug,
      });
    }
  }

  async backfillPublishedDomainsIntoRegistry(): Promise<void> {
    const rows = await db
      .select({
        organizationId: publishedSite.organizationId,
        domain: publishedSite.domain,
      })
      .from(publishedSite);

    for (const row of rows) {
      const normalizedDomain = this.normalizeDomain(row.domain);
      if (!normalizedDomain) continue;

      const existing = await db.query.domain.findFirst({
        where: eq(domainTable.domain, normalizedDomain),
        columns: { id: true, organizationId: true },
      });

      if (existing && existing.organizationId !== row.organizationId) {
        console.warn(
          `[DomainService] Skipping published-domain backfill for "${normalizedDomain}" due to org collision`,
        );
        continue;
      }

      if (!existing) {
        await db.insert(domainTable).values({
          id: crypto.randomUUID(),
          domain: normalizedDomain,
          organizationId: row.organizationId,
          type: "custom_domain",
          usage: "publish_target",
          status: "active",
          verificationMethod: null,
          verificationToken: null,
          verifiedAt: new Date(),
          createdById: null,
        });
      }
    }
  }

  async getActiveDomainRecord(hostname: string) {
    return db.query.domain.findFirst({
      where: and(eq(domainTable.domain, hostname), eq(domainTable.status, "active")),
      with: {
        organization: {
          columns: { id: true, slug: true },
        },
      },
    });
  }

  async resolveHost(requestHostHeader: string | null): Promise<ResolvedHost> {
    const requestHost = requestHostHeader ? this.normalizeHost(requestHostHeader) : null;
    const requestDomain = requestHost || null;
    const isSuperAdminHost = this.isSuperAdminHost(requestDomain);
    const routing = this.getTenantRoutingConfig();

    const domainRecord =
      routing.enabled && requestDomain
        ? (await this.getActiveDomainRecord(requestDomain)) ?? null
        : null;

    const controlPlaneHost = routing.controlPlaneHost;
    const isTenantBaseDomain = Boolean(
      requestDomain && routing.tenantBaseDomain && requestDomain === routing.tenantBaseDomain,
    );
    const isControlPlaneHost = Boolean(
      requestDomain &&
        ((controlPlaneHost && requestDomain === controlPlaneHost) ||
          isSuperAdminHost ||
          // Allow the tenant base domain (e.g. vivd.studio) to act as a control-plane alias
          // when it is not explicitly registered as an active tenant/publish domain.
          (isTenantBaseDomain && !domainRecord)),
    );

    let hostKind: HostKind = "unknown";
    if (domainRecord?.usage === "tenant_host") {
      hostKind = "tenant_host";
    } else if (domainRecord?.usage === "publish_target") {
      hostKind = "published_domain";
    } else if (isControlPlaneHost) {
      hostKind = "control_plane_host";
    }

    const hostOrganizationId =
      hostKind === "tenant_host" || hostKind === "published_domain"
        ? domainRecord?.organizationId ?? null
        : null;

    const hostOrganizationSlug =
      hostKind === "tenant_host" || hostKind === "published_domain"
        ? domainRecord?.organization?.slug ?? null
        : null;

    return {
      requestHost,
      requestDomain,
      hostKind,
      hostOrganizationId,
      hostOrganizationSlug,
      isSuperAdminHost,
      canSelectOrganization: hostKind === "control_plane_host",
    };
  }

  validateDomainForRegistry(input: string): { valid: boolean; normalized: string; error?: string } {
    const normalized = this.normalizeDomain(input);
    if (!normalized) {
      return { valid: false, normalized, error: "Domain is required" };
    }

    if (!ensureAsciiDomain(normalized)) {
      return {
        valid: false,
        normalized,
        error: "Domain must use ASCII characters (punycode for IDN).",
      };
    }

    if (normalized === "localhost" || normalized.endsWith(".local")) {
      return { valid: true, normalized };
    }

    const domainRegex =
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
    if (!domainRegex.test(normalized)) {
      return { valid: false, normalized, error: "Invalid domain format" };
    }

    const ipReserved = new Set(["127.0.0.1", "0.0.0.0"]);
    if (ipReserved.has(normalized)) {
      return {
        valid: false,
        normalized,
        error: "IP addresses are not supported, use a domain name",
      };
    }

    const publicPluginApiHost = this.getPublicPluginApiHost();
    if (normalized === publicPluginApiHost) {
      return {
        valid: false,
        normalized,
        error: `Domain "${normalized}" is reserved for the public plugin API host`,
      };
    }

    if (normalized === "api.localhost") {
      return {
        valid: false,
        normalized,
        error: `Domain "${normalized}" is reserved for local public plugin API routing`,
      };
    }

    const docsHost = this.getDocsHost();
    if (normalized === docsHost) {
      return {
        valid: false,
        normalized,
        error: `Domain "${normalized}" is reserved for the public docs host`,
      };
    }

    if (normalized === "docs.localhost") {
      return {
        valid: false,
        normalized,
        error: `Domain "${normalized}" is reserved for local public docs routing`,
      };
    }

    return { valid: true, normalized };
  }

  async ensurePublishDomainEnabled(options: {
    organizationId: string;
    domain: string;
  }): Promise<{
    enabled: boolean;
    normalizedDomain: string;
    message?: string;
    domainRowId?: string;
    usage?: DomainUsage;
  }> {
    const validation = this.validateDomainForRegistry(options.domain);
    if (!validation.valid) {
      return {
        enabled: false,
        normalizedDomain: validation.normalized,
        message: validation.error,
      };
    }

    const normalizedDomain = validation.normalized;
    const domainRow = await db.query.domain.findFirst({
      where: eq(domainTable.domain, normalizedDomain),
      columns: {
        id: true,
        organizationId: true,
        usage: true,
        status: true,
      },
    });

    if (!domainRow) {
      console.warn(
        `[PublishAllowlist] Denied domain="${normalizedDomain}" org="${options.organizationId}" (missing domain entry)`,
      );
      return {
        enabled: false,
        normalizedDomain,
        message: "Domain is not registered for this organization",
      };
    }

    if (domainRow.organizationId !== options.organizationId) {
      console.warn(
        `[PublishAllowlist] Denied domain="${normalizedDomain}" org="${options.organizationId}" (assigned to org="${domainRow.organizationId}")`,
      );
      return {
        enabled: false,
        normalizedDomain,
        message: "Domain is assigned to another organization",
      };
    }

    if (domainRow.status !== "active") {
      const status = domainRow.status as DomainStatus;
      const message =
        status === "pending_verification"
          ? "This domain isn't verified yet. Verify it before publishing."
          : status === "disabled"
            ? "This domain is disabled. Enable it before publishing."
            : "This domain isn't active yet. Activate it before publishing.";
      return {
        enabled: false,
        normalizedDomain,
        message,
      };
    }

    const publishableUsages: DomainUsage[] = ["publish_target", "tenant_host"];
    if (!publishableUsages.includes(domainRow.usage as DomainUsage)) {
      return {
        enabled: false,
        normalizedDomain,
        message: `Domain usage "${domainRow.usage}" cannot be used for publishing`,
      };
    }

    return {
      enabled: true,
      normalizedDomain,
      domainRowId: domainRow.id,
      usage: domainRow.usage as DomainUsage,
    };
  }

  async listOrganizationDomains(organizationId: string) {
    return db.query.domain.findMany({
      where: eq(domainTable.organizationId, organizationId),
      orderBy: [asc(domainTable.usage), asc(domainTable.domain)],
    });
  }

  async addOrganizationDomain(options: {
    organizationId: string;
    rawDomain: string;
    usage: DomainUsage;
    type: DomainType;
    status?: DomainStatus;
    createdById?: string;
  }) {
    const validation = this.validateDomainForRegistry(options.rawDomain);
    if (!validation.valid) {
      throw new Error(validation.error || "Invalid domain");
    }

    const normalizedDomain = validation.normalized;
    const existing = await db.query.domain.findFirst({
      where: eq(domainTable.domain, normalizedDomain),
      columns: {
        id: true,
        organizationId: true,
        usage: true,
        status: true,
        type: true,
        verificationMethod: true,
        verificationToken: true,
        verifiedAt: true,
      },
    });

    if (existing && existing.organizationId !== options.organizationId) {
      throw new Error(`Domain "${normalizedDomain}" is already assigned to another organization`);
    }

    if (existing && existing.organizationId === options.organizationId) {
      await db
        .update(domainTable)
        .set({
          usage: options.usage,
          type: options.type,
          status: options.status ?? existing.status,
          verificationMethod:
            options.type === "managed_subdomain" ? null : existing.verificationMethod,
          verificationToken:
            options.type === "managed_subdomain" ? null : existing.verificationToken,
          verifiedAt:
            options.type === "managed_subdomain"
              ? new Date()
              : options.status === "active"
                ? existing.verifiedAt
                : null,
        })
        .where(eq(domainTable.id, existing.id));

      return {
        id: existing.id,
        domain: normalizedDomain,
        created: false,
      };
    }

    const shouldBeActive = options.status ?? (options.type === "managed_subdomain" ? "active" : "pending_verification");
    const verifiedAt =
      options.type === "managed_subdomain" || shouldBeActive === "active"
        ? new Date()
        : null;

    const id = crypto.randomUUID();
    await db.insert(domainTable).values({
      id,
      domain: normalizedDomain,
      organizationId: options.organizationId,
      type: options.type,
      usage: options.usage,
      status: shouldBeActive,
      verificationMethod: options.type === "managed_subdomain" ? null : "dns_txt",
      verificationToken: null,
      verifiedAt,
      createdById: options.createdById ?? null,
    });

    return {
      id,
      domain: normalizedDomain,
      created: true,
    };
  }

  async setDomainStatus(domainId: string, status: DomainStatus) {
    await db
      .update(domainTable)
      .set({
        status,
        verifiedAt: status === "active" ? new Date() : null,
      })
      .where(eq(domainTable.id, domainId));
  }

  async setDomainUsage(domainId: string, usage: DomainUsage) {
    const row = await db.query.domain.findFirst({
      where: eq(domainTable.id, domainId),
      columns: {
        id: true,
        type: true,
        usage: true,
        status: true,
      },
    });
    if (!row) throw new Error("Domain not found");

    if (
      row.type === "managed_subdomain" &&
      row.usage === "tenant_host" &&
      usage !== "tenant_host" &&
      row.status === "active"
    ) {
      throw new Error("Cannot change usage for an active managed tenant host");
    }

    await db.update(domainTable).set({ usage }).where(eq(domainTable.id, domainId));
  }

  async startDomainVerification(domainId: string) {
    const row = await db.query.domain.findFirst({
      where: eq(domainTable.id, domainId),
      columns: {
        id: true,
        domain: true,
        type: true,
        status: true,
      },
    });

    if (!row) throw new Error("Domain not found");
    if (row.type === "managed_subdomain") {
      return {
        domainId: row.id,
        domain: row.domain,
        status: "active" as DomainStatus,
        verificationMethod: null,
        verificationToken: null,
        dnsTxtName: null,
        dnsTxtValue: null,
        httpPath: null,
        httpValue: null,
      };
    }

    const verificationToken = crypto.randomBytes(24).toString("hex");
    await db
      .update(domainTable)
      .set({
        status: "pending_verification",
        verificationMethod: "dns_txt",
        verificationToken,
        verifiedAt: null,
      })
      .where(eq(domainTable.id, domainId));

    return {
      domainId: row.id,
      domain: row.domain,
      status: "pending_verification" as DomainStatus,
      verificationMethod: "dns_txt" as DomainVerificationMethod,
      verificationToken,
      dnsTxtName: `_vivd-verify.${row.domain}`,
      dnsTxtValue: verificationToken,
      httpPath: "/.well-known/vivd-domain-verification.txt",
      httpValue: verificationToken,
    };
  }

  async checkDomainVerification(domainId: string): Promise<{
    verified: boolean;
    status: DomainStatus;
    verification: DomainVerificationResult;
  }> {
    const row = await db.query.domain.findFirst({
      where: eq(domainTable.id, domainId),
      columns: {
        id: true,
        domain: true,
        type: true,
        status: true,
        verificationMethod: true,
        verificationToken: true,
      },
    });

    if (!row) throw new Error("Domain not found");

    if (row.type === "managed_subdomain") {
      return {
        verified: true,
        status: "active",
        verification: {
          verified: true,
          method: null,
          detail: "Managed subdomain does not require verification",
        },
      };
    }

    if (!row.verificationMethod || !row.verificationToken) {
      return {
        verified: false,
        status: row.status as DomainStatus,
        verification: {
          verified: false,
          method: null,
          detail: "Verification has not been started",
        },
      };
    }

    const verification = await this.verifyDomainChallenge({
      domain: row.domain,
      method: row.verificationMethod as DomainVerificationMethod,
      token: row.verificationToken,
    });

    if (verification.verified) {
      await db
        .update(domainTable)
        .set({
          status: "active",
          verifiedAt: new Date(),
        })
        .where(eq(domainTable.id, domainId));

      return {
        verified: true,
        status: "active",
        verification,
      };
    }

    return {
      verified: false,
      status: "pending_verification",
      verification,
    };
  }

  async removeOrganizationDomain(domainId: string) {
    const row = await db.query.domain.findFirst({
      where: eq(domainTable.id, domainId),
      columns: {
        id: true,
        usage: true,
        status: true,
        type: true,
      },
    });
    if (!row) return { removed: false };

    if (
      row.usage === "tenant_host" &&
      row.type === "managed_subdomain" &&
      row.status === "active"
    ) {
      throw new Error("Cannot remove an active managed tenant host");
    }

    await db.delete(domainTable).where(eq(domainTable.id, domainId));
    return { removed: true };
  }

  async getTenantHostsForOrganizations(
    organizationIds: string[],
    options?: {
      preferredTenantBaseDomain?: string | null;
    },
  ): Promise<Map<string, string>> {
    if (organizationIds.length === 0) return new Map();

    const preferredTenantBaseDomain = options?.preferredTenantBaseDomain
      ? this.normalizeHost(options.preferredTenantBaseDomain)
      : null;

    const [orgs, rows] = await Promise.all([
      db.query.organization.findMany({
        where: inArray(organization.id, organizationIds),
        columns: { id: true, slug: true },
      }),
      db.query.domain.findMany({
        where: and(
          inArray(domainTable.organizationId, organizationIds),
          eq(domainTable.usage, "tenant_host"),
          eq(domainTable.status, "active"),
        ),
        columns: {
          organizationId: true,
          domain: true,
        },
      }),
    ]);

    const slugByOrganizationId = new Map(orgs.map((org) => [org.id, org.slug] as const));
    const domainsByOrganizationId = new Map<string, string[]>();
    for (const row of rows) {
      const list = domainsByOrganizationId.get(row.organizationId) ?? [];
      list.push(row.domain);
      domainsByOrganizationId.set(row.organizationId, list);
    }

    const routing = this.getTenantRoutingConfig();
    const configuredBaseDomain = routing.tenantBaseDomain;
    const result = new Map<string, string>();

    for (const [organizationId, domains] of domainsByOrganizationId.entries()) {
      if (domains.length === 0) continue;

      const slug = slugByOrganizationId.get(organizationId) ?? null;
      const domainSet = new Set(domains);

      if (slug && preferredTenantBaseDomain) {
        const candidate = `${slug}.${preferredTenantBaseDomain}`;
        if (domainSet.has(candidate)) {
          result.set(organizationId, candidate);
          continue;
        }
      }

      if (slug && configuredBaseDomain) {
        const candidate = `${slug}.${configuredBaseDomain}`;
        if (domainSet.has(candidate)) {
          result.set(organizationId, candidate);
          continue;
        }
      }

      // Stable fallback: pick lexicographically smallest.
      result.set(organizationId, [...domainSet].sort()[0]!);
    }

    return result;
  }

  async getActiveTenantHostForOrganization(
    organizationId: string,
    options?: { preferredTenantBaseDomain?: string | null },
  ): Promise<string | null> {
    const hosts = await this.getTenantHostsForOrganizations([organizationId], options);
    return hosts.get(organizationId) ?? null;
  }

  private async verifyDomainChallenge(options: {
    domain: string;
    method: DomainVerificationMethod;
    token: string;
  }): Promise<DomainVerificationResult> {
    if (options.method === "dns_txt") {
      const target = `_vivd-verify.${options.domain}`;
      try {
        const records = await dns.resolveTxt(target);
        const values = records.flat().map((entry) => entry.trim());
        const matched = values.includes(options.token);
        return {
          verified: matched,
          method: "dns_txt",
          detail: matched
            ? "TXT record verification passed"
            : `TXT record not found for ${target}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          verified: false,
          method: "dns_txt",
          detail: `DNS lookup failed: ${message}`,
        };
      }
    }

    const url = `http://${options.domain}/.well-known/vivd-domain-verification.txt`;
    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        return {
          verified: false,
          method: "http_file",
          detail: `HTTP verification failed with status ${response.status}`,
        };
      }
      const body = (await response.text()).trim();
      const matched = body === options.token;
      return {
        verified: matched,
        method: "http_file",
        detail: matched
          ? "HTTP file verification passed"
          : "HTTP verification token did not match",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        verified: false,
        method: "http_file",
        detail: `HTTP verification failed: ${message}`,
      };
    }
  }
}

export const domainService = new DomainService();
