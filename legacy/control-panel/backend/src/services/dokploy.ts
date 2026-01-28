import { z } from "zod";

// Dokploy API response types
// Note: Dokploy returns inconsistent ID field names (projectId vs id), so we include both
export interface DokployProject {
  projectId?: string;
  id?: string;
  name: string;
  description: string | null;
  createdAt?: string;
  environments?: DokployEnvironment[];
}

export interface DokployEnvironment {
  environmentId?: string;
  id?: string;
  name: string;
  projectId?: string;
}

export interface DokployCompose {
  composeId?: string;
  id?: string;
  name: string;
  appName: string;
  description: string | null;
  composeFile: string;
  composeStatus: "idle" | "running" | "done" | "error";
  projectId?: string;
  createdAt?: string;
}

export interface DokployDomain {
  domainId: string;
  host: string;
  port: number;
  https: boolean;
  composeId?: string;
  serviceName?: string;
}

/** Extract ID from Dokploy response (handles inconsistent field names) */
export function extractProjectId(project: DokployProject): string | null {
  return project.projectId || project.id || null;
}

export function extractComposeId(compose: DokployCompose): string | null {
  return compose.composeId || compose.id || null;
}

export function extractEnvironmentId(env: DokployEnvironment): string | null {
  return env.environmentId || env.id || null;
}

// Request schemas
export const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const createComposeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string(),
  environmentId: z.string().min(1),
  composeFile: z.string(),
  appName: z.string().optional(),
  composeType: z.string().optional(),
});

export const createDomainSchema = z.object({
  host: z.string().min(1),
  composeId: z.string(),
  serviceName: z.string(),
  port: z.number().default(80),
  https: z.boolean().default(true),
  domainType: z.literal("compose").default("compose"),
});

export const setEnvVarsSchema = z.object({
  composeId: z.string(),
  env: z.string(), // KEY=VALUE format, newline separated
});

/**
 * Dokploy API Service
 *
 * Handles all interactions with the Dokploy REST API for managing
 * projects, compose services, domains, and deployments.
 */
export class DokployService {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: { baseUrl: string; apiKey: string }) {
    // Remove trailing slash if present
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/api/${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dokploy API error (${response.status}): ${errorText}`);
    }

    // Some endpoints return empty response
    const text = await response.text();
    if (!text) return {} as T;

    return JSON.parse(text) as T;
  }

  // ============ Projects ============

  /**
   * Create a new Dokploy project
   */
  async createProject(
    data: z.infer<typeof createProjectSchema>
  ): Promise<DokployProject> {
    return this.request<DokployProject>("project.create", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<DokployProject[]> {
    return this.request<DokployProject[]>("project.all", {
      method: "GET",
    });
  }

  /**
   * Get project by ID with its environments
   */
  async getProject(
    projectId: string
  ): Promise<DokployProject & { environments: DokployEnvironment[] }> {
    return this.request<
      DokployProject & { environments: DokployEnvironment[] }
    >(`project.one?projectId=${projectId}`, { method: "GET" });
  }

  // ============ Compose ============

  private normalizeComposeType(value: string): string {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "raw") return "docker-compose";
    return trimmed;
  }

  private getDefaultComposeType(): string {
    return this.normalizeComposeType(
      process.env.DOKPLOY_COMPOSE_TYPE?.trim() || "docker-compose"
    );
  }

  private getDefaultSourceType(): string {
    return process.env.DOKPLOY_SOURCE_TYPE?.trim() || "raw";
  }

  private async updateCompose(
    composeId: string,
    patch: Record<string, unknown>
  ) {
    await this.request("compose.update", {
      method: "POST",
      body: JSON.stringify({ composeId, ...patch }),
    });
  }

  /**
   * Create a new Docker Compose service
   */
  async createCompose(
    data: z.infer<typeof createComposeSchema>
  ): Promise<DokployCompose> {
    const explicitType = data.composeType?.trim();
    const preferredType = explicitType
      ? this.normalizeComposeType(explicitType)
      : this.getDefaultComposeType();

    const attempt = async (composeType: string) =>
      this.request<DokployCompose>("compose.create", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          composeType,
        }),
      });

    try {
      return await attempt(preferredType);
    } catch (error) {
      if (!explicitType && !process.env.DOKPLOY_COMPOSE_TYPE) {
        return attempt("docker-compose");
      }
      throw error;
    }
  }

  /**
   * Get compose service by ID
   */
  async getCompose(composeId: string): Promise<DokployCompose> {
    return this.request<DokployCompose>(`compose.one?composeId=${composeId}`, {
      method: "GET",
    });
  }

  /**
   * Update compose file content
   */
  async updateComposeFile(
    composeId: string,
    composeFile: string
  ): Promise<void> {
    await this.updateCompose(composeId, { composeFile });
  }

  /**
   * Set environment variables for a compose service
   */
  async setEnvironmentVariables(
    composeId: string,
    env: Record<string, string>,
    options?: {
      composeType?: string;
      sourceType?: string;
      composeFile?: string;
    }
  ): Promise<void> {
    // Convert object to KEY=VALUE format
    const envString = Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    await this.updateCompose(composeId, {
      env: envString,
      ...(options?.composeFile ? { composeFile: options.composeFile } : {}),
      composeType: options?.composeType
        ? this.normalizeComposeType(options.composeType)
        : this.getDefaultComposeType(),
      sourceType: options?.sourceType || this.getDefaultSourceType(),
    });
  }

  /**
   * Trigger a redeploy of a compose service
   */
  async redeployCompose(composeId: string): Promise<void> {
    await this.request("compose.redeploy", {
      method: "POST",
      body: JSON.stringify({ composeId }),
    });
  }

  /**
   * Delete a compose service
   */
  async deleteCompose(composeId: string): Promise<void> {
    await this.request("compose.remove", {
      method: "POST",
      body: JSON.stringify({ composeId }),
    });
  }

  // ============ Domains ============

  /**
   * Create a domain for a compose service
   */
  async createDomain(
    data: z.infer<typeof createDomainSchema>
  ): Promise<DokployDomain> {
    return this.request<DokployDomain>("domain.create", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * List domains for a compose service
   */
  async listDomains(composeId: string): Promise<DokployDomain[]> {
    return this.request<DokployDomain[]>(
      `domain.byComposeId?composeId=${composeId}`,
      {
        method: "GET",
      }
    );
  }

  /**
   * Delete a domain
   */
  async deleteDomain(domainId: string): Promise<void> {
    await this.request("domain.delete", {
      method: "POST",
      body: JSON.stringify({ domainId }),
    });
  }

  // ============ Utility ============

  /**
   * Check if the API connection is working
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.listProjects();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance - configured from environment
let dokployInstance: DokployService | null = null;

export function getDokployService(): DokployService {
  if (!dokployInstance) {
    const baseUrl = process.env.DOKPLOY_URL;
    const apiKey = process.env.DOKPLOY_API_KEY;

    if (!baseUrl || !apiKey) {
      throw new Error(
        "DOKPLOY_URL and DOKPLOY_API_KEY environment variables are required"
      );
    }

    dokployInstance = new DokployService({ baseUrl, apiKey });
  }
  return dokployInstance;
}
