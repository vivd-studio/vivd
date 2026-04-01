import { z } from "zod";
import {
  adminProcedure,
  orgProcedure,
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
import { OPENROUTER_API_KEY, validateConfig } from "../../generator/config";
import fs from "fs";
import path from "path";
import { publishService } from "../../services/publish/PublishService";
import { gitService } from "../../services/integrations/GitService";
import { db } from "../../db";
import { projectMember, projectPluginInstance } from "../../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { limitsService } from "../../services/usage/LimitsService";
import { detectProjectType } from "../../devserver/projectType";
import { buildService } from "../../services/project/BuildService";
import { projectMetaService } from "../../services/project/ProjectMetaService";
import {
  uploadProjectPreviewToBucket,
  uploadProjectSourceToBucket,
} from "../../services/project/ProjectArtifactsService";
import { thumbnailService } from "../../services/project/ThumbnailService";
import { alignProjectArtifactKeyToSlug } from "../../services/project/slugRename";
import { prepareStudioInitialGenerationHandoff } from "../../services/project/StudioInitialGenerationService";
import { analyzeImages } from "../../generator/image_analyzer";
import { scraperClient } from "../../generator/scraper-client";
import {
  applyScratchAstroStarter,
  createScratchInitialGenerationManifest,
  getScratchCreationMode,
  readInitialGenerationManifest,
  writeInitialGenerationManifest,
} from "../../generator/initialGeneration";
import { installProfileService } from "../../services/system/InstallProfileService";
import { ensureGitRepositoryHasInitialCommit } from "../../generator/gitUtils";

/**
 * Check if single project mode is enabled and a project already exists.
 * In single project mode, only one project is allowed.
 */
async function checkSingleProjectModeLimit(organizationId: string): Promise<void> {
  if (!(await installProfileService.isSingleProjectModeEnabled())) {
    return; // Not in single project mode
  }

  const projectSlugs = await listProjectSlugs(organizationId);
  if (projectSlugs.length > 0) {
    throw new Error(
      "Single project mode is enabled and a project already exists. " +
        "Delete the existing project before creating a new one.",
    );
  }
}

async function syncArtifactsAfterGeneration(options: {
  versionDir: string;
  organizationId: string;
  slug: string;
  version: number;
}): Promise<void> {
  const projectConfig = detectProjectType(options.versionDir);
  const commitHash = await gitService.getCurrentCommit(options.versionDir);

  await uploadProjectSourceToBucket({
    organizationId: options.organizationId,
    versionDir: options.versionDir,
    slug: options.slug,
    version: options.version,
    meta: {
      status: "ready",
      framework: projectConfig.framework,
      commitHash: commitHash ?? undefined,
      completedAt: new Date().toISOString(),
    },
  });

  if (projectConfig.framework === "astro") {
    const distPath = await buildService.buildSync(options.versionDir, "dist");
    await uploadProjectPreviewToBucket({
      organizationId: options.organizationId,
      localDir: distPath,
      slug: options.slug,
      version: options.version,
      meta: {
        status: "ready",
        framework: "astro",
        commitHash: commitHash ?? undefined,
        completedAt: new Date().toISOString(),
      },
    });
  }

  // Generate thumbnail only after artifacts are synced to storage.
  try {
    await thumbnailService.generateThumbnailImmediate(
      options.versionDir,
      options.organizationId,
      options.slug,
      options.version,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Thumbnail] Post-sync generation failed: ${msg}`);
  }
}

async function syncSourceArtifactForStudioStart(options: {
  versionDir: string;
  organizationId: string;
  slug: string;
  version: number;
}): Promise<void> {
  const projectConfig = detectProjectType(options.versionDir);
  const commitHash = await gitService.getCurrentCommit(options.versionDir);

  await uploadProjectSourceToBucket({
    organizationId: options.organizationId,
    versionDir: options.versionDir,
    slug: options.slug,
    version: options.version,
    meta: {
      status: "ready",
      framework: projectConfig.framework,
      commitHash: commitHash ?? undefined,
      completedAt: new Date().toISOString(),
    },
  });
}

async function prepareScratchStudioGeneration(options: {
  organizationId: string;
  slug: string;
  versionDir: string;
  referenceUrls?: string[];
}): Promise<void> {
  const normalizedReferenceUrls = normalizeReferenceUrls(options.referenceUrls);

  if (normalizedReferenceUrls?.length) {
    await scraperClient.captureScreenshots(
      normalizedReferenceUrls,
      options.versionDir,
      4,
    );
  }

  if (OPENROUTER_API_KEY) {
    await analyzeImages(options.versionDir, {
      flowId: "scratch",
      organizationId: options.organizationId,
      projectSlug: options.slug,
    });
    return;
  }

  console.warn(
    `[ScratchStudio] Skipping image analysis for ${options.slug} because OPENROUTER_API_KEY is not configured.`,
  );
}

function normalizeReferenceUrls(urls?: string[]): string[] | undefined {
  if (!urls?.length) return undefined;

  const normalized = urls
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) =>
      /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`,
    )
    .map((candidate) => {
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return null;
        }
        return parsed.toString();
      } catch {
        return null;
      }
    })
    .filter((url): url is string => Boolean(url));

  if (!normalized.length) return undefined;
  return Array.from(new Set(normalized));
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
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      // Check usage limits before allowing generation (costs LLM tokens)
      await limitsService.assertNotBlocked(organizationId);

      // Enforce single project mode limit (only for new projects)
      const { url, createNewVersion } = input;

      // Only check limit if this is a brand new project (not a new version of existing)
      if (!createNewVersion) {
        let targetUrl = url;
        if (!targetUrl.startsWith("http")) targetUrl = "https://" + targetUrl;
        const domainSlug = new URL(targetUrl).hostname
          .replace("www.", "")
          .split(".")[0];

        const existing = await getManifest(organizationId, domainSlug);
        if (!existing) {
          await checkSingleProjectModeLimit(organizationId);
        }
      }

      // Ensure consistent slug generation
      let targetUrl = url;
      if (!targetUrl.startsWith("http")) targetUrl = "https://" + targetUrl;
      const domainSlug = new URL(targetUrl).hostname
        .replace("www.", "")
        .split(".")[0];

      const manifest = await getManifest(organizationId, domainSlug);
      if (manifest) {
        const currentVersion = await getCurrentVersion(organizationId, domainSlug);

        if (manifest && currentVersion > 0) {
          // Check if any version is currently processing (but not stale)
          const currentVersionData = await getVersionData(organizationId, domainSlug, currentVersion);
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
          const nextVersion = await getNextVersion(organizationId, domainSlug);
          processUrl(url, nextVersion, {
            organizationId,
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
                  organizationId,
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
        organizationId,
        heroHint: input.heroHint,
        htmlHint: input.htmlHint,
      })
        .then(async (result) => {
          console.log(`Finished processing ${url} (version 1)`);
          try {
            await syncArtifactsAfterGeneration({
              versionDir: result.outputDir,
              organizationId,
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
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      // Check usage limits before allowing scratch generation (costs LLM tokens)
      await limitsService.assertNotBlocked(organizationId);

      // Enforce single project mode limit
      await checkSingleProjectModeLimit(organizationId);

      validateConfig();

      const generationCtx = await createGenerationContext({
        organizationId,
        source: "scratch",
        title: input.title,
        description: input.description,
        allowSlugSuffix: true,
        initialStatus: "pending",
      });

      runScratchFlow(generationCtx, input)
        .then(async () => {
          console.log(
            `Finished scratch generation for ${generationCtx.slug} (version ${generationCtx.version})`,
          );
          try {
            await syncArtifactsAfterGeneration({
              versionDir: generationCtx.outputDir,
              organizationId,
              slug: generationCtx.slug,
              version: generationCtx.version,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Artifacts] Post-generation upload failed: ${msg}`);
          }
        })
        .catch((err) => {
          console.error(
            `Error during scratch generation for ${generationCtx.slug}:`,
            err,
          );
          try {
            generationCtx.updateStatus("failed");
          } catch {
            // ignore
          }
        });

      return {
        status: "processing",
        slug: generationCtx.slug,
        version: generationCtx.version,
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
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const scratchCreationMode = getScratchCreationMode();
      // Check usage limits early to prevent disk spam
      await limitsService.assertNotBlocked(organizationId);

      // Enforce single project mode limit
      await checkSingleProjectModeLimit(organizationId);

      if (scratchCreationMode === "legacy_html") {
        validateConfig();
      }
      const normalizedReferenceUrls = normalizeReferenceUrls(input.referenceUrls);

      // Create context with "uploading_assets" status
      const generationCtx = await createGenerationContext({
        organizationId,
        source: "scratch",
        title: input.title,
        description: input.description,
        allowSlugSuffix: true,
        initialStatus: "uploading_assets",
      });

      if (scratchCreationMode === "studio_astro") {
        applyScratchAstroStarter({
          versionDir: generationCtx.outputDir,
        });
      }

      // Create images and references directories for uploads
      const imagesDir = path.join(generationCtx.outputDir, "images");
      const referencesDir = path.join(generationCtx.outputDir, "references");
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

      fs.writeFileSync(path.join(generationCtx.outputDir, "scratch_brief.txt"), brief);

      if (normalizedReferenceUrls?.length) {
        fs.writeFileSync(
          path.join(generationCtx.outputDir, "references", "urls.txt"),
          normalizedReferenceUrls.join("\n") + "\n",
        );
      }

      // Store metadata for startScratchGeneration to use
      const draftMetaPath = path.join(generationCtx.outputDir, ".scratch_draft.json");
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
          referenceUrls: normalizedReferenceUrls,
        }),
      );

      if (scratchCreationMode === "studio_astro") {
        writeInitialGenerationManifest(
          generationCtx.outputDir,
          createScratchInitialGenerationManifest({
            title: input.title,
            description: input.description,
            businessType: input.businessType,
            stylePreset: input.stylePreset,
            stylePalette: input.stylePalette,
            styleMode: input.styleMode,
            siteTheme: input.siteTheme,
            referenceUrls: normalizedReferenceUrls,
          }),
        );
      }

      return {
        status: "uploading_assets",
        slug: generationCtx.slug,
        version: generationCtx.version,
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
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug, version } = input;
      const scratchCreationMode = getScratchCreationMode();

      // Re-check usage limits (this is the paid step)
      await limitsService.assertNotBlocked(organizationId);

      const versionDir = getVersionDir(organizationId, slug, version);

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

      if (scratchCreationMode === "studio_astro") {
        const generationCtx = await createGenerationContext({
          organizationId,
          source: "scratch",
          title: draftMeta.title,
          description: draftMeta.description,
          slug,
          version,
          allowSlugSuffix: false,
          initialStatus: "pending",
        });
        try {
          if (Array.isArray(draftMeta.referenceUrls) && draftMeta.referenceUrls.length > 0) {
            generationCtx.updateStatus("capturing_references");
          }
          await prepareScratchStudioGeneration({
            organizationId,
            slug,
            versionDir,
            referenceUrls: draftMeta.referenceUrls,
          });

          writeInitialGenerationManifest(
            versionDir,
            {
              ...createScratchInitialGenerationManifest({
                title: draftMeta.title,
                description: draftMeta.description,
                businessType: draftMeta.businessType,
                stylePreset: draftMeta.stylePreset,
                stylePalette: draftMeta.stylePalette,
                styleMode: draftMeta.styleMode,
                siteTheme: draftMeta.siteTheme,
                referenceUrls: draftMeta.referenceUrls,
              }),
              state: "starting_studio",
            },
          );

          generationCtx.updateStatus("starting_studio");
          await ensureGitRepositoryHasInitialCommit(
            versionDir,
            "Initial generation",
          );
          await syncSourceArtifactForStudioStart({
            versionDir,
            organizationId,
            slug,
            version,
          });

          await prepareStudioInitialGenerationHandoff({
            organizationId,
            projectSlug: slug,
            version,
            requestHost: ctx.requestHost,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          generationCtx.updateStatus("failed", message);
          throw error;
        }

        return {
          status: "starting_studio",
          slug,
          version,
          message: "Studio handoff ready.",
          studioHandoff: {
            mode: "studio_astro" as const,
            initialGeneration: true,
            sessionId: null,
          },
        };
      }

      // Create a generation context pointing to existing version
      const generationCtx = await createGenerationContext({
        organizationId,
        source: "scratch",
        title: draftMeta.title,
        description: draftMeta.description,
        slug, // Use existing slug
        version, // Use existing version
        allowSlugSuffix: false, // Don't auto-suffix
        initialStatus: "pending",
      });

      // Run scratch flow without base64 assets (they're already uploaded)
      runScratchFlow(generationCtx, {
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
          void syncArtifactsAfterGeneration({
            versionDir,
            organizationId,
            slug,
            version,
          }).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Artifacts] Post-generation upload failed: ${msg}`);
          });

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
            generationCtx.updateStatus("failed");
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
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      // Check usage limits before allowing regeneration (costs LLM tokens)
      await limitsService.assertNotBlocked(organizationId);

      const { slug, version } = input;
      const manifest = await getManifest(organizationId, slug);
      if (!manifest) {
        throw new Error("Project not found");
      }

      const targetVersion = version ?? (await getCurrentVersion(organizationId, slug));
      if (targetVersion === 0) {
        throw new Error("No versions found for this project");
      }

      const versionDir = getVersionDir(organizationId, slug, targetVersion);
      const versionData = await getVersionData(organizationId, slug, targetVersion);

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
      processUrl(url, targetVersion, { organizationId })
        .then(async (result) => {
          console.log(
            `Finished regenerating ${url} (version ${targetVersion})`,
          );
          try {
            await syncArtifactsAfterGeneration({
              versionDir: result.outputDir,
              organizationId,
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
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug, version } = input;
      const manifest = await getManifest(organizationId, slug);
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

      const versionData = await getVersionData(organizationId, slug, targetVersion);
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
      const versionDir = getVersionDir(organizationId, slug, targetVersion);
      const initialGenerationManifest =
        source === "scratch" ? readInitialGenerationManifest(versionDir) : null;

      // On preview open, sync from GitHub (best-effort).
      // Skips automatically if there are local uncommitted changes.
      if (status === "completed") {
        if (fs.existsSync(versionDir)) {
          await gitService.syncPullFromGitHub({
            cwd: versionDir,
            slug,
            version: targetVersion,
            tenantId: organizationId,
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
        studioHandoff:
          initialGenerationManifest?.mode === "studio_astro"
            ? {
                mode: "studio_astro" as const,
                initialGeneration: true,
                sessionId: initialGenerationManifest.sessionId ?? null,
              }
            : undefined,
      };
    }),

  list: orgProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId!;
    // Check if user is a client_editor
    const isClientEditor = ctx.organizationRole === "client_editor";
    let assignedProjectSlug: string | null = null;

    if (isClientEditor) {
      const membership = await db.query.projectMember.findFirst({
        where: and(
          eq(projectMember.organizationId, organizationId),
          eq(projectMember.userId, ctx.session.user.id),
        ),
      });
      assignedProjectSlug = membership?.projectSlug ?? null;

      // If client editor has no assigned project, return empty list
      if (!assignedProjectSlug) {
        return { projects: [] };
      }
    }

    try {
      // Fetch all published sites upfront for efficient lookup
      const publishedSites =
        await publishService.getPublishedSitesForOrganization(organizationId);

      const projectSlugs = await listProjectSlugs(organizationId);
      const filteredSlugs = isClientEditor
        ? projectSlugs.filter((slug) => slug === assignedProjectSlug)
        : projectSlugs;
      const enabledPluginRows =
        filteredSlugs.length > 0
          ? await db.query.projectPluginInstance.findMany({
              where: and(
                eq(projectPluginInstance.organizationId, organizationId),
                inArray(projectPluginInstance.projectSlug, filteredSlugs),
                eq(projectPluginInstance.status, "enabled"),
              ),
              columns: {
                projectSlug: true,
                pluginId: true,
              },
            })
          : [];
      const enabledPluginsBySlug = new Map<string, string[]>();
      for (const row of enabledPluginRows) {
        const current = enabledPluginsBySlug.get(row.projectSlug) ?? [];
        current.push(row.pluginId);
        enabledPluginsBySlug.set(row.projectSlug, current);
      }

      const projects = await Promise.all(
        filteredSlugs.map(async (slug) => {
          const manifest = await getManifest(organizationId, slug);
          if (!manifest) return null;

          const currentVersion = manifest.currentVersion;
          const versionData =
            currentVersion > 0 ? await getVersionData(organizationId, slug, currentVersion) : null;

          const title = versionData?.title || (manifest as any).title || "";
          const sourceRaw = (versionData?.source ?? manifest.source) as
            | string
            | undefined;
          const source: "url" | "scratch" =
            sourceRaw === "scratch" ? "scratch" : manifest.url ? "url" : "scratch";

          const publishInfo = publishedSites.get(slug);

          const thumbnailKey = alignProjectArtifactKeyToSlug({
            organizationId,
            slug,
            key: versionData?.thumbnailKey ?? null,
          });
          const thumbnailUrl = thumbnailKey
            ? `/vivd-studio/api/projects/${encodeURIComponent(slug)}/v${currentVersion}/thumbnail`
            : null;

          return {
            slug,
            status: versionData?.status || "unknown",
            url: versionData?.url || manifest.url,
            source,
            title,
            tags: manifest.tags,
            createdAt: manifest.createdAt,
            updatedAt: manifest.updatedAt,
            currentVersion,
            publicPreviewEnabled: manifest.publicPreviewEnabled,
            totalVersions: manifest.versions.length,
            versions: manifest.versions,
            publishedDomain: publishInfo?.domain ?? null,
            publishedVersion: publishInfo?.projectVersion ?? null,
            thumbnailUrl,
            enabledPlugins: enabledPluginsBySlug.get(slug) ?? [],
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
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug, version } = input;
      const manifest = await getManifest(organizationId, slug);
      if (!manifest) throw new Error("Project not found");

      // Validate that the version exists
      const versionExists = manifest.versions.some(
        (v) => v.version === version,
      );
      if (!versionExists) {
        throw new Error(`Version ${version} does not exist for this project`);
      }

      await projectMetaService.setCurrentVersion(organizationId, slug, version);
      await projectMetaService.touchUpdatedAt(organizationId, slug);

      return {
        success: true,
        slug,
        currentVersion: version,
        message: `Current version set to ${version}`,
      };
    }),
};
