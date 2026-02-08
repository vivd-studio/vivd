import { z } from "zod";
import {
  protectedProcedure,
  adminProcedure,
  projectMemberProcedure,
} from "../../trpc";
import { processUrl } from "../../generator/index";
import {
  getVersionDir,
  getManifest,
  getCurrentVersion,
  getNextVersion,
  getVersionData,
  isVersionStale,
  listProjectSlugs,
  PROCESSING_STATUSES,
} from "../../generator/versionUtils";
import { createGenerationContext } from "../../generator/core/context";
import { runScratchFlow } from "../../generator/flows/scratchFlow";
import { validateConfig } from "../../generator/config";
import fs from "fs";
import path from "path";
import { publishService } from "../../services/PublishService";
import { gitService } from "../../services/GitService";
import { db } from "../../db";
import { projectMember } from "../../db/schema";
import { eq } from "drizzle-orm";
import { limitsService } from "../../services/LimitsService";
import { detectProjectType } from "../../devserver/projectType";
import { buildService } from "../../services/BuildService";
import { projectMetaService } from "../../services/ProjectMetaService";
import {
  uploadProjectPreviewToBucket,
  uploadProjectSourceToBucket,
} from "../../services/ProjectArtifactsService";
import { getObjectDownloadUrl } from "../../services/ObjectStorageService";

/**
 * Check if single project mode is enabled and a project already exists.
 * In single project mode, only one project is allowed.
 */
async function checkSingleProjectModeLimit(): Promise<void> {
  if (process.env.SINGLE_PROJECT_MODE !== "true") {
    return; // Not in single project mode
  }

  const projectSlugs = await listProjectSlugs();
  if (projectSlugs.length > 0) {
    throw new Error(
      "Single project mode is enabled and a project already exists. " +
        "Delete the existing project before creating a new one.",
    );
  }
}

async function syncArtifactsAfterGeneration(options: {
  versionDir: string;
  slug: string;
  version: number;
}): Promise<void> {
  const projectConfig = detectProjectType(options.versionDir);

  await uploadProjectSourceToBucket({
    versionDir: options.versionDir,
    slug: options.slug,
    version: options.version,
    meta: {
      status: "ready",
      framework: projectConfig.framework,
      completedAt: new Date().toISOString(),
    },
  });

  if (projectConfig.framework !== "astro") return;

  const distPath = await buildService.buildSync(options.versionDir, "dist");
  await uploadProjectPreviewToBucket({
    localDir: distPath,
    slug: options.slug,
    version: options.version,
    meta: {
      status: "ready",
      framework: "astro",
      completedAt: new Date().toISOString(),
    },
  });
}

export const projectGenerationProcedures = {
  generate: adminProcedure
    .input(
      z.object({
        url: z.string().min(1),
        createNewVersion: z.boolean().optional(),
        /** Optional hint to influence the hero image generation */
        heroHint: z.string().optional(),
        /** Optional hint to influence the HTML/landing page generation */
        htmlHint: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Check usage limits before allowing generation (costs LLM tokens)
      await limitsService.assertNotBlocked();

      // Enforce single project mode limit (only for new projects)
      const { url, createNewVersion } = input;

      // Only check limit if this is a brand new project (not a new version of existing)
      if (!createNewVersion) {
        let targetUrl = url;
        if (!targetUrl.startsWith("http")) targetUrl = "https://" + targetUrl;
        const domainSlug = new URL(targetUrl).hostname
          .replace("www.", "")
          .split(".")[0];

        const existing = await getManifest(domainSlug);
        if (!existing) {
          await checkSingleProjectModeLimit();
        }
      }

      // Ensure consistent slug generation
      let targetUrl = url;
      if (!targetUrl.startsWith("http")) targetUrl = "https://" + targetUrl;
      const domainSlug = new URL(targetUrl).hostname
        .replace("www.", "")
        .split(".")[0];

      const manifest = await getManifest(domainSlug);
      if (manifest) {
        const currentVersion = await getCurrentVersion(domainSlug);

        if (manifest && currentVersion > 0) {
          // Check if any version is currently processing (but not stale)
          const currentVersionData = await getVersionData(domainSlug, currentVersion);
          const status = currentVersionData?.status || "unknown";
          const versionInfo = manifest.versions.find(
            (v) => v.version === currentVersion,
          );

          // If status is processing but stale (>30 min), allow regeneration
          const isStale = isVersionStale(versionInfo || currentVersionData);

          if (PROCESSING_STATUSES.includes(status) && !isStale) {
            throw new Error("Project is currently being generated");
          }

          if (!createNewVersion) {
            // Return exists status with version info
            return {
              status: "exists",
              slug: domainSlug,
              currentVersion,
              totalVersions: manifest.versions.length,
              message: "Project already exists",
            };
          }

          // Create new version
          const nextVersion = await getNextVersion(domainSlug);
          processUrl(url, nextVersion, {
            heroHint: input.heroHint,
            htmlHint: input.htmlHint,
          })
            .then(async (result) => {
              console.log(
                `Finished processing ${url} (version ${nextVersion})`,
              );
              try {
                await syncArtifactsAfterGeneration({
                  versionDir: result.outputDir,
                  slug: result.domainSlug,
                  version: result.version,
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[Artifacts] Post-generation upload failed: ${msg}`);
              }
            })
            .catch((err) => {
              console.error(`Error processing ${url}:`, err);
            });

          return {
            status: "processing",
            slug: domainSlug,
            version: nextVersion,
            message: `Creating version ${nextVersion}`,
          };
        }
      }

      // New project - create version 1
      processUrl(url, 1, {
        heroHint: input.heroHint,
        htmlHint: input.htmlHint,
      })
        .then(async (result) => {
          console.log(`Finished processing ${url} (version 1)`);
          try {
            await syncArtifactsAfterGeneration({
              versionDir: result.outputDir,
              slug: result.domainSlug,
              version: result.version,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Artifacts] Post-generation upload failed: ${msg}`);
          }
        })
        .catch((err) => {
          console.error(`Error processing ${url}:`, err);
        });

      return {
        status: "processing",
        slug: domainSlug,
        version: 1,
        message: "Generation started.",
      };
    }),

  generateFromScratch: adminProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        businessType: z.string().optional(),
        stylePreset: z.string().optional(),
        stylePalette: z.array(z.string().min(1)).optional(),
        styleMode: z.enum(["exact", "reference"]).optional(),
        siteTheme: z.enum(["dark", "light"]).optional(),
        referenceUrls: z.array(z.string().min(1)).optional(),
        assets: z
          .array(
            z.object({
              filename: z.string().min(1),
              base64: z.string().min(1),
            }),
          )
          .max(20)
          .optional(),
        referenceImages: z
          .array(
            z.object({
              filename: z.string().min(1),
              base64: z.string().min(1),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Check usage limits before allowing scratch generation (costs LLM tokens)
      await limitsService.assertNotBlocked();

      // Enforce single project mode limit
      await checkSingleProjectModeLimit();

      validateConfig();

      const ctx = await createGenerationContext({
        source: "scratch",
        title: input.title,
        description: input.description,
        allowSlugSuffix: true,
        initialStatus: "pending",
      });

      runScratchFlow(ctx, input)
        .then(async () => {
          console.log(
            `Finished scratch generation for ${ctx.slug} (version ${ctx.version})`,
          );
          try {
            await syncArtifactsAfterGeneration({
              versionDir: ctx.outputDir,
              slug: ctx.slug,
              version: ctx.version,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Artifacts] Post-generation upload failed: ${msg}`);
          }
        })
        .catch((err) => {
          console.error(
            `Error during scratch generation for ${ctx.slug}:`,
            err,
          );
          try {
            ctx.updateStatus("failed");
          } catch {
            // ignore
          }
        });

      return {
        status: "processing",
        slug: ctx.slug,
        version: ctx.version,
        message: "Generation started.",
      };
    }),

  /**
   * Step 1 of 3-step upload flow: Create a draft project for scratch generation.
   * Returns slug/version so frontend can upload files via multipart.
   */
  createScratchDraft: adminProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        businessType: z.string().optional(),
        stylePreset: z.string().optional(),
        stylePalette: z.array(z.string().min(1)).optional(),
        styleMode: z.enum(["exact", "reference"]).optional(),
        siteTheme: z.enum(["dark", "light"]).optional(),
        referenceUrls: z.array(z.string().min(1)).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Check usage limits early to prevent disk spam
      await limitsService.assertNotBlocked();

      // Enforce single project mode limit
      await checkSingleProjectModeLimit();

      validateConfig();

      // Create context with "uploading_assets" status
      const ctx = await createGenerationContext({
        source: "scratch",
        title: input.title,
        description: input.description,
        allowSlugSuffix: true,
        initialStatus: "uploading_assets",
      });

      // Create images and references directories for uploads
      const imagesDir = path.join(ctx.outputDir, "images");
      const referencesDir = path.join(ctx.outputDir, "references");
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }
      if (!fs.existsSync(referencesDir)) {
        fs.mkdirSync(referencesDir, { recursive: true });
      }

      // Write the brief and metadata now (so scratchFlow can skip this if needed)
      const brief = [
        `Title: ${input.title}`,
        input.businessType ? `Business type: ${input.businessType}` : null,
        "",
        "Description:",
        input.description,
        input.stylePreset ? "" : null,
        input.stylePreset ? `Style preset: ${input.stylePreset}` : null,
        input.stylePreset && input.styleMode
          ? `Style mode: ${input.styleMode}`
          : null,
        input.stylePreset && input.stylePalette?.length
          ? `Style palette: ${input.stylePalette.join(", ")}`
          : null,
        input.siteTheme ? `Site theme: ${input.siteTheme}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      fs.writeFileSync(path.join(ctx.outputDir, "scratch_brief.txt"), brief);

      if (input.referenceUrls?.length) {
        fs.writeFileSync(
          path.join(ctx.outputDir, "references", "urls.txt"),
          input.referenceUrls.join("\n") + "\n",
        );
      }

      // Store metadata for startScratchGeneration to use
      const draftMetaPath = path.join(ctx.outputDir, ".scratch_draft.json");
      fs.writeFileSync(
        draftMetaPath,
        JSON.stringify({
          title: input.title,
          description: input.description,
          businessType: input.businessType,
          stylePreset: input.stylePreset,
          stylePalette: input.stylePalette,
          styleMode: input.styleMode,
          siteTheme: input.siteTheme,
          referenceUrls: input.referenceUrls,
        }),
      );

      return {
        status: "uploading_assets",
        slug: ctx.slug,
        version: ctx.version,
        message: "Draft created. Upload assets now.",
      };
    }),

  /**
   * Step 3 of 3-step upload flow: Start generation after assets have been uploaded.
   */
  startScratchGeneration: adminProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        version: z.number().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;

      // Re-check usage limits (this is the paid step)
      await limitsService.assertNotBlocked();

      const versionDir = getVersionDir(slug, version);

      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      // Read stored metadata
      const draftMetaPath = path.join(versionDir, ".scratch_draft.json");
      if (!fs.existsSync(draftMetaPath)) {
        throw new Error(
          "Draft metadata not found. Use createScratchDraft first.",
        );
      }

      const draftMeta = JSON.parse(fs.readFileSync(draftMetaPath, "utf-8"));

      // Create a generation context pointing to existing version
      const ctx = await createGenerationContext({
        source: "scratch",
        title: draftMeta.title,
        description: draftMeta.description,
        slug, // Use existing slug
        version, // Use existing version
        allowSlugSuffix: false, // Don't auto-suffix
        initialStatus: "pending",
      });

      // Run scratch flow without base64 assets (they're already uploaded)
      runScratchFlow(ctx, {
        title: draftMeta.title,
        description: draftMeta.description,
        businessType: draftMeta.businessType,
        stylePreset: draftMeta.stylePreset,
        stylePalette: draftMeta.stylePalette,
        styleMode: draftMeta.styleMode,
        siteTheme: draftMeta.siteTheme,
        referenceUrls: draftMeta.referenceUrls,
        // No assets or referenceImages - they're already on disk
      })
        .then(() => {
          console.log(
            `Finished scratch generation for ${slug} (version ${version})`,
          );
          // Clean up draft metadata
          try {
            fs.unlinkSync(draftMetaPath);
          } catch {
            // ignore
          }
        })
        .catch((err) => {
          console.error(`Error during scratch generation for ${slug}:`, err);
          try {
            ctx.updateStatus("failed");
          } catch {
            // ignore
          }
        });

      return {
        status: "processing",
        slug,
        version,
        message: "Generation started.",
      };
    }),

  regenerate: adminProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Check usage limits before allowing regeneration (costs LLM tokens)
      await limitsService.assertNotBlocked();

      const { slug, version } = input;
      const manifest = await getManifest(slug);
      if (!manifest) {
        throw new Error("Project not found");
      }

      const targetVersion = version ?? (await getCurrentVersion(slug));
      if (targetVersion === 0) {
        throw new Error("No versions found for this project");
      }

      const versionDir = getVersionDir(slug, targetVersion);
      const versionData = await getVersionData(slug, targetVersion);

      if (!versionData) {
        throw new Error("Version metadata not found");
      }

      const url = versionData.url;
      if (!url) {
        throw new Error("Original URL not found in version metadata");
      }

      // Delete the version directory contents
      if (fs.existsSync(versionDir)) {
        fs.rmSync(versionDir, { recursive: true, force: true });
      }

      // Regenerate the same version
      processUrl(url, targetVersion)
        .then(async (result) => {
          console.log(
            `Finished regenerating ${url} (version ${targetVersion})`,
          );
          try {
            await syncArtifactsAfterGeneration({
              versionDir: result.outputDir,
              slug: result.domainSlug,
              version: result.version,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Artifacts] Post-generation upload failed: ${msg}`);
          }
        })
        .catch((err) => {
          console.error(`Error regenerating ${url}:`, err);
        });

      return {
        status: "processing",
        slug,
        version: targetVersion,
        message: `Regenerating version ${targetVersion}`,
      };
    }),

  status: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const manifest = await getManifest(slug);
      const targetVersion = version ?? manifest?.currentVersion ?? 0;

      if (targetVersion === 0 || !manifest) {
        return {
          status: "not_found",
          url: undefined,
          originalUrl: "",
          createdAt: "",
          version: 0,
          totalVersions: 0,
        };
      }

      const versionData = await getVersionData(slug, targetVersion);
      const status = versionData?.status || "unknown";
      const originalUrl = versionData?.url || manifest.url || "";
      const createdAt = versionData?.createdAt || "";
      const sourceRaw = (versionData?.source ?? manifest.source) as
        | string
        | undefined;
      const title =
        versionData?.title ||
        ((manifest as any).title as string | undefined) ||
        "";
      const source: "url" | "scratch" =
        sourceRaw === "scratch" ? "scratch" : manifest.url ? "url" : "scratch";

      // On preview open, sync from GitHub (best-effort).
      // Skips automatically if there are local uncommitted changes.
      if (status === "completed") {
        const versionDir = getVersionDir(slug, targetVersion);
        if (fs.existsSync(versionDir)) {
          await gitService.syncPullFromGitHub({
            cwd: versionDir,
            slug,
            version: targetVersion,
          });
        }
      }

      // Build the preview URL for the specific version
      const resultUrl =
        status === "completed"
          ? `/projects/${slug}/v${targetVersion}/index.html`
          : undefined;

      // Get error message from version data if status is failed
      const errorMessage =
        status === "failed"
          ? versionData?.errorMessage ||
            manifest.versions.find((v) => v.version === targetVersion)
              ?.errorMessage
          : undefined;

      return {
        status,
        url: resultUrl,
        originalUrl,
        source,
        title,
        createdAt,
        version: targetVersion,
        totalVersions: manifest.versions.length,
        versions: manifest.versions,
        errorMessage,
      };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    // Check if user is a client_editor
    const isClientEditor = ctx.session.user.role === "client_editor";
    let assignedProjectSlug: string | null = null;

    if (isClientEditor) {
      const membership = await db.query.projectMember.findFirst({
        where: eq(projectMember.userId, ctx.session.user.id),
      });
      assignedProjectSlug = membership?.projectSlug ?? null;

      // If client editor has no assigned project, return empty list
      if (!assignedProjectSlug) {
        return { projects: [] };
      }
    }

    try {
      // Fetch all published sites upfront for efficient lookup
      const publishedSites = await publishService.getAllPublishedSites();

      const projectSlugs = await listProjectSlugs();
      const filteredSlugs = isClientEditor
        ? projectSlugs.filter((slug) => slug === assignedProjectSlug)
        : projectSlugs;

      const projects = await Promise.all(
        filteredSlugs.map(async (slug) => {
          const manifest = await getManifest(slug);
          if (!manifest) return null;

          const currentVersion = manifest.currentVersion;
          const versionData =
            currentVersion > 0 ? await getVersionData(slug, currentVersion) : null;

          const title = versionData?.title || (manifest as any).title || "";
          const sourceRaw = (versionData?.source ?? manifest.source) as
            | string
            | undefined;
          const source: "url" | "scratch" =
            sourceRaw === "scratch" ? "scratch" : manifest.url ? "url" : "scratch";

          const publishInfo = publishedSites.get(slug);

          const thumbnailUrl =
            versionData?.thumbnailKey
              ? await getObjectDownloadUrl({
                  key: versionData.thumbnailKey,
                  expiresInSeconds: 60 * 60,
                })
              : null;

          return {
            slug,
            status: versionData?.status || "unknown",
            url: versionData?.url || manifest.url,
            source,
            title,
            createdAt: manifest.createdAt,
            updatedAt: manifest.updatedAt,
            currentVersion,
            totalVersions: manifest.versions.length,
            versions: manifest.versions,
            publishedDomain: publishInfo?.domain ?? null,
            publishedVersion: publishInfo?.projectVersion ?? null,
            thumbnailUrl,
          };
        }),
      );

      return {
        projects: projects.filter(
          (project): project is NonNullable<typeof project> => project !== null,
        ),
      };
    } catch (error) {
      console.error("Failed to list projects:", error);
      throw new Error("Failed to list projects");
    }
  }),

  /**
   * Set the current version for a project (persists to DB)
   */
  setCurrentVersion: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;
      const manifest = await getManifest(slug);
      if (!manifest) throw new Error("Project not found");

      // Validate that the version exists
      const versionExists = manifest.versions.some(
        (v) => v.version === version,
      );
      if (!versionExists) {
        throw new Error(`Version ${version} does not exist for this project`);
      }

      await projectMetaService.setCurrentVersion(slug, version);
      await projectMetaService.touchUpdatedAt(slug);

      return {
        success: true,
        slug,
        currentVersion: version,
        message: `Current version set to ${version}`,
      };
    }),
};
