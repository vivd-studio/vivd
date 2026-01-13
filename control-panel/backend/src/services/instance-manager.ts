import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  vivdInstances,
  deployments,
  type VivdInstance,
  type NewVivdInstance,
} from "../db/schema.js";
import { getDokployService } from "./dokploy.js";
import {
  generateComposeFile,
  type InstanceConfig,
} from "../templates/compose.js";
import { randomBytes } from "crypto";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDokployErrorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/Dokploy API error \((\d+)\):/);
  return match ? Number(match[1]) : null;
}

/**
 * Generate a random ID for database records
 */
function generateId(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * Generate a secure secret for Better Auth
 */
function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Generate a slug from a name
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface CreateInstanceRequest {
  name: string;
  slug?: string;
  domain: string;

  // Configuration
  singleProjectMode?: boolean;
  githubRepoPrefix?: string;
  opencodeModel?: string;

  // API Keys (optional - uses shared if not provided)
  openrouterApiKey?: string;
  googleApiKey?: string;
  githubToken?: string;

  // Scraper config
  scraperUrl?: string;
  scraperApiKey?: string;
}

export interface InstanceManagerConfig {
  // Shared API keys (used when per-instance not provided)
  sharedOpenrouterApiKey?: string;
  sharedGoogleApiKey?: string;
  sharedGithubToken?: string;
  sharedGithubOrg?: string;
  sharedOpencodeModel?: string;

  // Default scraper
  defaultScraperUrl?: string;
  defaultScraperApiKey?: string;
}

/**
 * Instance Manager Service
 *
 * High-level orchestration for creating, managing, and deploying vivd instances.
 * Coordinates between the database and Dokploy API.
 */
export class InstanceManager {
  private config: InstanceManagerConfig;

  constructor(config: InstanceManagerConfig = {}) {
    this.config = {
      sharedOpenrouterApiKey: process.env.SHARED_OPENROUTER_API_KEY,
      sharedGoogleApiKey: process.env.SHARED_GOOGLE_API_KEY,
      sharedGithubToken: process.env.SHARED_GITHUB_TOKEN,
      sharedGithubOrg: process.env.SHARED_GITHUB_ORG,
      sharedOpencodeModel:
        process.env.SHARED_OPENCODE_MODEL || process.env.OPENCODE_MODEL,
      defaultScraperUrl: process.env.DEFAULT_SCRAPER_URL,
      defaultScraperApiKey: process.env.DEFAULT_SCRAPER_API_KEY,
      ...config,
    };
  }

  /**
   * Create a new vivd instance
   *
   * This is the main orchestration method that:
   * 1. Creates a project in Dokploy
   * 2. Creates the compose service with the docker-compose file
   * 3. Sets environment variables
   * 4. Creates the domain
   * 5. Triggers deployment
   * 6. Saves to our database
   */
  async createInstance(request: CreateInstanceRequest): Promise<VivdInstance> {
    const dokploy = getDokployService();
    const instanceId = generateId();
    const slug = request.slug || slugify(request.name);
    let dokployProjectId: string | null = null;
    let dokployComposeId: string | null = null;

    // Generate secrets and credentials
    const betterAuthSecret = generateSecret();
    const postgresPassword = generateSecret();
    const opencodeModel =
      request.opencodeModel || this.config.sharedOpencodeModel || "";
    if (!opencodeModel) {
      throw new Error(
        "OPENCODE_MODEL is required to deploy instances. Set SHARED_OPENCODE_MODEL on the control-panel or pass opencodeModel when creating an instance."
      );
    }

    // Build instance config for compose file generation
    const instanceConfig: InstanceConfig = {
      domain: request.domain,
      betterAuthUrl: `https://${request.domain}`,
      betterAuthSecret,
      opencodeModel,

      // Database
      postgresUser: "vivd",
      postgresPassword,
      postgresDb: `vivd_${slug.replace(/-/g, "_")}`,

      // API Keys (per-instance or fallback to shared)
      openrouterApiKey:
        request.openrouterApiKey || this.config.sharedOpenrouterApiKey || "",
      googleApiKey:
        request.googleApiKey || this.config.sharedGoogleApiKey || "",

      // GitHub
      githubToken: request.githubToken || this.config.sharedGithubToken || "",
      githubOrg: this.config.sharedGithubOrg || "",
      githubRepoPrefix: request.githubRepoPrefix || `${slug}-`,
      githubSyncEnabled: !!(
        request.githubToken || this.config.sharedGithubToken
      ),

      // Scraper
      scraperUrl: request.scraperUrl || this.config.defaultScraperUrl || "",
      scraperApiKey:
        request.scraperApiKey || this.config.defaultScraperApiKey || "",

      // Features
      singleProjectMode: request.singleProjectMode || false,
    };

    try {
      // Step 1: Create Dokploy project
      console.log(`Creating Dokploy project for ${request.name}...`);
      const createdProject = await dokploy.createProject({
        name: `vivd-${slug}`,
        description: `Vivd instance: ${request.name}`,
      });

      const createdProjectName = (createdProject as { name?: string }).name;

      dokployProjectId =
        (createdProject as { projectId?: string; id?: string }).projectId ||
        (createdProject as { projectId?: string; id?: string }).id ||
        null;

      if (!dokployProjectId) {
        const projects = await dokploy.listProjects();
        const match = projects.find(
          (p) => p.name === (createdProjectName || `vivd-${slug}`)
        );
        dokployProjectId =
          (match as { projectId?: string; id?: string } | undefined)?.projectId ||
          (match as { projectId?: string; id?: string } | undefined)?.id ||
          null;
      }

      if (!dokployProjectId) {
        throw new Error(
          `Dokploy did not return a usable project id for project ${createdProjectName || `vivd-${slug}`}`
        );
      }

      // Dokploy requires an environmentId when creating compose services
      console.log(`Resolving Dokploy environment...`);
      let environments: { environmentId?: string; id?: string; name: string }[] =
        (createdProject as { environments?: { environmentId?: string; id?: string; name: string }[] })
          .environments ?? [];

      let lastProjectFetchError: unknown = null;
      let delayMs = 300;
      for (let attempt = 1; attempt <= 10; attempt++) {
        if (environments.length > 0) break;
        try {
          const projectWithEnvironments = await dokploy.getProject(dokployProjectId);
          environments =
            (projectWithEnvironments as { environments?: typeof environments })
              .environments ?? [];
          if (environments.length > 0) break;
        } catch (error) {
          lastProjectFetchError = error;
          const status = getDokployErrorStatus(error);
          if (status && ![404, 502, 503].includes(status)) {
            throw error;
          }
        }

        await sleep(delayMs);
        delayMs = Math.min(delayMs * 2, 3000);
      }

      if (environments.length === 0) {
        const errorMessage =
          lastProjectFetchError instanceof Error
            ? lastProjectFetchError.message
            : lastProjectFetchError
              ? String(lastProjectFetchError)
              : "Unknown error";
        throw new Error(
          `Failed to resolve environments for Dokploy project ${dokployProjectId}: ${errorMessage}`
        );
      }

      const preferredEnvironmentName =
        process.env.DOKPLOY_ENVIRONMENT_NAME?.trim().toLowerCase() || null;

      let environment =
        preferredEnvironmentName
          ? environments.find(
              (env) => env.name.toLowerCase() === preferredEnvironmentName
            )
          : undefined;

      if (!environment) {
        environment = environments.find((env) =>
          env.name.toLowerCase().includes("prod")
        );
      }

      if (!environment) {
        environment = environments[0];
      }

      const environmentId =
        (environment as { environmentId?: string; id?: string }).environmentId ||
        (environment as { environmentId?: string; id?: string }).id ||
        null;

      if (!environmentId) {
        throw new Error(
          `Selected Dokploy environment has no environmentId (name: ${environment.name})`
        );
      }

      // Step 2: Create compose service
      console.log(`Creating compose service...`);
      const composeFile = generateComposeFile(instanceConfig);
      const compose = await dokploy.createCompose({
        name: request.name,
        projectId: dokployProjectId,
        environmentId,
        composeFile,
        appName: `vivd-${slug}`,
      });

      dokployComposeId =
        (compose as { composeId?: string; id?: string }).composeId ||
        (compose as { composeId?: string; id?: string }).id ||
        null;

      if (!dokployComposeId) {
        throw new Error(
          `Dokploy did not return a usable compose id for instance ${request.name}`
        );
      }

      // Step 3: Set environment variables
      console.log(`Setting environment variables...`);
      const envVars = this.buildEnvironmentVariables(instanceConfig);
      await dokploy.setEnvironmentVariables(dokployComposeId, envVars, {
        composeType: "docker-compose",
        sourceType: "raw",
        composeFile,
      });

      // Step 4: Create domain (pointing to caddy on port 80)
      console.log(`Creating domain ${request.domain}...`);
      await dokploy.createDomain({
        host: request.domain,
        composeId: dokployComposeId,
        serviceName: "caddy",
        port: 80,
        https: true,
        domainType: "compose",
      });

      // Step 5: Save to database
      console.log(`Saving instance to database...`);
      const newInstance: NewVivdInstance = {
        id: instanceId,
        name: request.name,
        slug,
        domain: request.domain,
        dokployComposeId,
        dokployProjectId,
        status: "deploying",
        singleProjectMode: request.singleProjectMode || false,
        githubRepoPrefix: instanceConfig.githubRepoPrefix,
        // Store encrypted env vars for reference (sensitive values should be encrypted)
        environmentVariables: {
          DOMAIN: instanceConfig.domain,
          SINGLE_PROJECT_MODE: String(instanceConfig.singleProjectMode),
          GITHUB_REPO_PREFIX: instanceConfig.githubRepoPrefix,
        },
      };

      await db.insert(vivdInstances).values(newInstance);

      // Step 6: Create deployment record
      const deploymentId = generateId();
      await db.insert(deployments).values({
        id: deploymentId,
        instanceId,
        version: "latest",
        status: "pending",
        triggeredBy: "system",
      });

      // Step 7: Trigger deployment
      console.log(`Triggering deployment...`);
      await dokploy.redeployCompose(dokployComposeId);

      // Update deployment status
      await db
        .update(deployments)
        .set({ status: "running" })
        .where(eq(deployments.id, deploymentId));

      // Fetch and return the created instance
      const [instance] = await db
        .select()
        .from(vivdInstances)
        .where(eq(vivdInstances.id, instanceId));

      console.log(`✓ Instance ${request.name} created successfully!`);
      return instance;
    } catch (error) {
      console.error(`Failed to create instance ${request.name}:`, error);

      // Save failed instance to database for debugging
      await db
        .insert(vivdInstances)
        .values({
          id: instanceId,
          name: request.name,
          slug,
          domain: request.domain,
          dokployProjectId,
          dokployComposeId,
          status: "error",
          singleProjectMode: request.singleProjectMode || false,
        })
        .onConflictDoNothing();

      throw error;
    }
  }

  /**
   * Build environment variables for docker-compose
   */
  private buildEnvironmentVariables(
    config: InstanceConfig
  ): Record<string, string> {
    return {
      DOMAIN: config.domain,
      BETTER_AUTH_URL: config.betterAuthUrl,
      BETTER_AUTH_SECRET: config.betterAuthSecret,

      POSTGRES_USER: config.postgresUser,
      POSTGRES_PASSWORD: config.postgresPassword,
      POSTGRES_DB: config.postgresDb,

      OPENROUTER_API_KEY: config.openrouterApiKey,
      GOOGLE_API_KEY: config.googleApiKey,
      OPENCODE_MODEL: config.opencodeModel,

      GITHUB_SYNC_ENABLED: String(config.githubSyncEnabled),
      GITHUB_TOKEN: config.githubToken,
      GITHUB_ORG: config.githubOrg,
      GITHUB_REPO_PREFIX: config.githubRepoPrefix,

      SCRAPER_URL: config.scraperUrl,
      SCRAPER_API_KEY: config.scraperApiKey,

      SINGLE_PROJECT_MODE: String(config.singleProjectMode),

      // Static config
      VITE_APP_ENV: "production",
    };
  }

  /**
   * List all instances
   */
  async listInstances(): Promise<VivdInstance[]> {
    return db.select().from(vivdInstances);
  }

  /**
   * List all instances and best-effort sync "deploying" statuses from Dokploy.
   *
   * This keeps the UI from getting stuck in "deploying" when Dokploy has already
   * finished or errored, without requiring a manual sync action.
   */
  async listInstancesWithStatusSync(): Promise<VivdInstance[]> {
    const instances = await this.listInstances();
    const pending = instances.filter(
      (instance) =>
        instance.status === "deploying" && Boolean(instance.dokployComposeId)
    );

    if (pending.length === 0) return instances;

    const dokploy = getDokployService();

    await Promise.allSettled(
      pending.map(async (instance) => {
        const composeId = instance.dokployComposeId;
        if (!composeId) return;

        try {
          const compose = await dokploy.getCompose(composeId);

          let status: "active" | "stopped" | "error" | "deploying" =
            instance.status;
          switch (compose.composeStatus) {
            case "running":
              status = "deploying";
              break;
            case "done":
              status = "active";
              break;
            case "error":
              status = "error";
              break;
            case "idle":
              status = "stopped";
              break;
          }

          if (status === instance.status) return;

          await db
            .update(vivdInstances)
            .set({ status, updatedAt: new Date() })
            .where(eq(vivdInstances.id, instance.id));
        } catch {
          // Best-effort; keep existing status if Dokploy is temporarily unavailable.
        }
      })
    );

    return this.listInstances();
  }

  /**
   * Get a specific instance
   */
  async getInstance(id: string): Promise<VivdInstance | null> {
    const [instance] = await db
      .select()
      .from(vivdInstances)
      .where(eq(vivdInstances.id, id));
    return instance || null;
  }

  /**
   * Get instance by slug
   */
  async getInstanceBySlug(slug: string): Promise<VivdInstance | null> {
    const [instance] = await db
      .select()
      .from(vivdInstances)
      .where(eq(vivdInstances.slug, slug));
    return instance || null;
  }

  /**
   * Trigger a redeploy of an instance
   */
  async redeployInstance(id: string): Promise<void> {
    const instance = await this.getInstance(id);
    if (!instance) {
      throw new Error(`Instance ${id} not found`);
    }
    if (!instance.dokployComposeId) {
      throw new Error(`Instance ${id} has no Dokploy compose ID`);
    }

    const dokploy = getDokployService();

    // Create deployment record
    const deploymentId = generateId();
    await db.insert(deployments).values({
      id: deploymentId,
      instanceId: id,
      version: "latest",
      status: "running",
      triggeredBy: "user",
    });

    // Update instance status
    await db
      .update(vivdInstances)
      .set({ status: "deploying", updatedAt: new Date() })
      .where(eq(vivdInstances.id, id));

    // Trigger redeploy
    await dokploy.redeployCompose(instance.dokployComposeId);
  }

  /**
   * Delete an instance
   */
  async deleteInstance(id: string): Promise<void> {
    const instance = await this.getInstance(id);
    if (!instance) {
      throw new Error(`Instance ${id} not found`);
    }

    const dokploy = getDokployService();

    // Delete from Dokploy if we have a compose ID
    if (instance.dokployComposeId) {
      try {
        await dokploy.deleteCompose(instance.dokployComposeId);
      } catch (error) {
        console.warn(`Failed to delete compose from Dokploy:`, error);
      }
    }

    // Delete from our database
    await db.delete(vivdInstances).where(eq(vivdInstances.id, id));
  }

  /**
   * Sync instance status from Dokploy
   */
  async syncInstanceStatus(id: string): Promise<VivdInstance> {
    const instance = await this.getInstance(id);
    if (!instance || !instance.dokployComposeId) {
      throw new Error(`Instance ${id} not found or has no Dokploy compose ID`);
    }

    const dokploy = getDokployService();
    const compose = await dokploy.getCompose(instance.dokployComposeId);

    // Map Dokploy status to our status
    let status: "active" | "stopped" | "error" | "deploying" = "active";
    switch (compose.composeStatus) {
      case "running":
        status = "deploying";
        break;
      case "done":
        status = "active";
        break;
      case "error":
        status = "error";
        break;
      case "idle":
        status = "stopped";
        break;
    }

    await db
      .update(vivdInstances)
      .set({ status, updatedAt: new Date() })
      .where(eq(vivdInstances.id, id));

    return (await this.getInstance(id))!;
  }
}

// Singleton
let instanceManagerInstance: InstanceManager | null = null;

export function getInstanceManager(): InstanceManager {
  if (!instanceManagerInstance) {
    instanceManagerInstance = new InstanceManager();
  }
  return instanceManagerInstance;
}
