import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  createCmsEntry,
  updateCmsEntryFields,
  scaffoldCmsEntry,
  scaffoldCmsModel,
  scaffoldCmsWorkspace,
  updateCmsModel,
  validateCmsWorkspace,
  type CmsEntryFieldUpdate,
  type CmsFieldDefinition,
  type CmsValidationReport,
} from "@vivd/shared/cms";
import { router, publicProcedure } from "../trpc/trpc.js";
import { projectTouchReporter } from "../services/reporting/ProjectTouchReporter.js";
import { requestBucketSync } from "../services/sync/AgentTaskSyncService.js";

type CmsPrepareResult = {
  report: CmsValidationReport;
  built: boolean;
  validationOnly: boolean;
  error: string | null;
};

type CmsTextFileWrite = {
  relativePath: string;
  content: string;
};

type CmsTextFileSnapshot = CmsTextFileWrite & {
  targetPath: string;
  tempPath: string;
  existedAsFile: boolean;
  originalContent: string | null;
};

const CMS_TEXT_FILE_PATH_REGEX = /\.(?:json|ya?ml|md|mdx|markdown)$/i;
const CMS_PREVIEW_COPYABLE_IMAGE_REGEX = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

type CmsPreviewAssetAction = {
  kind: "copy-to-entry";
  sourcePath: string;
};

type CmsPreviewEntryFieldUpdate = CmsEntryFieldUpdate & {
  assetAction?: CmsPreviewAssetAction;
};

async function prepareCmsArtifacts(projectDir: string): Promise<CmsPrepareResult> {
  const report = await validateCmsWorkspace(projectDir);
  if (!report.initialized) {
    return {
      report,
      built: false,
      validationOnly: false,
      error: report.errors.join("\n"),
    };
  }
  if (!report.valid) {
    return {
      report,
      built: false,
      validationOnly: false,
      error: `CMS validation failed:\n- ${report.errors.join("\n- ")}`,
    };
  }
  return {
    report,
    built: false,
    validationOnly: true,
    error: null,
  };
}

function requireWorkspace(ctx: { workspace: { isInitialized(): boolean; getProjectPath(): string } }) {
  if (!ctx.workspace.isInitialized()) {
    throw new Error("Workspace not initialized");
  }
  return ctx.workspace.getProjectPath();
}

function hasDotSegment(relativePath: string): boolean {
  return relativePath.split(/[\\/]+/).some((segment) => segment === "." || segment === "..");
}

function isTextFile(relativePath: string): boolean {
  return CMS_TEXT_FILE_PATH_REGEX.test(relativePath);
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeWorkspaceRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function sanitizeFilename(filename: string): string {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const safeBase = base.replace(/^-+|-+$/g, "") || "asset";
  return `${safeBase}${ext.toLowerCase()}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch (error) {
    const code = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : null;
    if (code === "ENOENT") return false;
    throw error;
  }
}

async function getUniqueDestinationFilename(
  destinationDir: string,
  requestedFilename: string,
): Promise<string> {
  const safeFilename = sanitizeFilename(requestedFilename);
  const ext = path.extname(safeFilename);
  const base = path.basename(safeFilename, ext);

  let index = 1;
  while (true) {
    const candidate = index === 1 ? safeFilename : `${base}-${index}${ext}`;
    if (!(await fileExists(path.join(destinationDir, candidate)))) {
      return candidate;
    }
    index += 1;
  }
}

async function copyPreviewAssetToEntryMedia(
  projectDir: string,
  update: CmsPreviewEntryFieldUpdate,
): Promise<CmsEntryFieldUpdate> {
  const report = await validateCmsWorkspace(projectDir);
  if (!report.initialized) {
    throw new Error("CMS workspace not initialized");
  }

  const model = report.models.find((item) => item.key === update.modelKey);
  if (!model) {
    throw new Error(`Collection not found: ${update.modelKey}`);
  }

  const entry = model.entries.find((item) => item.key === update.entryKey);
  if (!entry) {
    throw new Error(`Entry not found: ${update.modelKey}:${update.entryKey}`);
  }

  const sourcePath = normalizeWorkspaceRelativePath(
    update.assetAction?.sourcePath ?? "",
  );
  if (!sourcePath) {
    throw new Error("Source image path is required");
  }
  if (path.isAbsolute(sourcePath) || hasDotSegment(sourcePath)) {
    throw new Error("Invalid source image path");
  }
  if (!CMS_PREVIEW_COPYABLE_IMAGE_REGEX.test(sourcePath)) {
    throw new Error("Only local image assets can be copied into CMS media");
  }

  const sourceAbsolutePath = path.join(projectDir, sourcePath);
  const realProjectDir = await fs.realpath(projectDir);
  const realSourcePath = await fs.realpath(sourceAbsolutePath);
  if (!isPathInsideRoot(realProjectDir, realSourcePath)) {
    throw new Error("Invalid source image path");
  }

  const sourceStats = await fs.stat(realSourcePath);
  if (!sourceStats.isFile()) {
    throw new Error("Source image path is not a file");
  }

  const destinationDirRelativePath = path.posix.join(
    "src/content/media",
    update.modelKey,
    update.entryKey,
  );
  const destinationDir = path.join(projectDir, destinationDirRelativePath);
  await fs.mkdir(destinationDir, { recursive: true });
  const realDestinationDir = await fs.realpath(destinationDir);
  if (!isPathInsideRoot(realProjectDir, realDestinationDir)) {
    throw new Error("Invalid destination media path");
  }

  const destinationFilename = await getUniqueDestinationFilename(
    destinationDir,
    path.basename(sourcePath),
  );
  const destinationRelativePath = path.posix.join(
    destinationDirRelativePath,
    destinationFilename,
  );
  await fs.copyFile(realSourcePath, path.join(projectDir, destinationRelativePath));

  return {
    modelKey: update.modelKey,
    entryKey: update.entryKey,
    fieldPath: update.fieldPath,
    value: destinationRelativePath,
  };
}

async function resolvePreviewAssetActions(
  projectDir: string,
  updates: CmsPreviewEntryFieldUpdate[],
): Promise<CmsEntryFieldUpdate[]> {
  const resolved: CmsEntryFieldUpdate[] = [];
  for (const update of updates) {
    if (update.assetAction?.kind === "copy-to-entry") {
      resolved.push(await copyPreviewAssetToEntryMedia(projectDir, update));
    } else {
      resolved.push({
        modelKey: update.modelKey,
        entryKey: update.entryKey,
        fieldPath: update.fieldPath,
        value: update.value,
      });
    }
  }
  return resolved;
}

async function buildCmsTextFileSnapshots(
  projectDir: string,
  files: CmsTextFileWrite[],
): Promise<CmsTextFileSnapshot[]> {
  const filesByPath = new Map<string, CmsTextFileWrite>();
  for (const file of files) {
    const normalizedRelativePath = file.relativePath.replace(/\\/g, "/").trim();
    if (!normalizedRelativePath) {
      throw new Error("File path is required");
    }

    const existing = filesByPath.get(normalizedRelativePath);
    if (existing && existing.content !== file.content) {
      throw new Error(`Duplicate CMS save target: ${normalizedRelativePath}`);
    }
    filesByPath.set(normalizedRelativePath, {
      relativePath: normalizedRelativePath,
      content: file.content,
    });
  }

  const realProjectDir = await fs.realpath(projectDir);
  const timestamp = Date.now();

  return Promise.all(
    [...filesByPath.values()].map(async (file, index) => {
      if (hasDotSegment(file.relativePath) || path.isAbsolute(file.relativePath)) {
        throw new Error("Invalid path");
      }
      if (!isTextFile(file.relativePath)) {
        throw new Error("File is not a text file");
      }

      const targetPath = path.join(projectDir, file.relativePath);
      const parentDir = path.dirname(targetPath);
      let realParentDir: string;
      try {
        realParentDir = await fs.realpath(parentDir);
      } catch {
        throw new Error("Parent directory does not exist");
      }

      if (!isPathInsideRoot(realProjectDir, realParentDir)) {
        throw new Error("Invalid path");
      }

      let existedAsFile = false;
      let originalContent: string | null = null;
      try {
        const stats = await fs.stat(targetPath);
        if (stats.isFile()) {
          existedAsFile = true;
          originalContent = await fs.readFile(targetPath, "utf8");
        }
      } catch (error) {
        const code = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : null;
        if (code !== "ENOENT") {
          throw error;
        }
      }

      const tempPath = path.join(
        parentDir,
        `.${path.basename(targetPath)}.vivd-tmp-${process.pid}-${timestamp}-${index}`,
      );

      return {
        ...file,
        targetPath,
        tempPath,
        existedAsFile,
        originalContent,
      };
    }),
  );
}

async function rollbackCmsTextFileSnapshots(snapshots: CmsTextFileSnapshot[]): Promise<void> {
  for (const snapshot of [...snapshots].reverse()) {
    try {
      if (snapshot.existedAsFile) {
        await fs.writeFile(snapshot.targetPath, snapshot.originalContent ?? "", "utf8");
      } else {
        await fs.rm(snapshot.targetPath, { force: true });
      }
    } catch {
      // Best-effort rollback. The original error is still more useful to surface.
    }
  }
}

async function runCmsTextFileTransaction<T>(
  projectDir: string,
  files: CmsTextFileWrite[],
  work: () => Promise<T>,
): Promise<{ saved: string[]; result: T }> {
  const snapshots = await buildCmsTextFileSnapshots(projectDir, files);
  const renamedSnapshots: CmsTextFileSnapshot[] = [];

  try {
    for (const snapshot of snapshots) {
      await fs.writeFile(snapshot.tempPath, snapshot.content, "utf8");
    }

    for (const snapshot of snapshots) {
      await fs.rename(snapshot.tempPath, snapshot.targetPath);
      renamedSnapshots.push(snapshot);
    }

    const result = await work();
    return {
      saved: snapshots.map((snapshot) => snapshot.relativePath),
      result,
    };
  } catch (error) {
    await Promise.all(
      snapshots.map(async (snapshot) => {
        try {
          await fs.rm(snapshot.tempPath, { force: true });
        } catch {
          // Ignore temp cleanup failures during rollback.
        }
      }),
    );
    await rollbackCmsTextFileSnapshots(renamedSnapshots);
    throw error;
  }
}

function markCmsWorkspaceChange(slug: string, version: number, reason: string) {
  projectTouchReporter.touch(slug);
  requestBucketSync(reason, {
    slug,
    version,
  });
}

const mutationInput = z.object({
  slug: z.string(),
  version: z.number(),
});

const cmsFieldDefinitionSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    type: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    localized: z.boolean().optional(),
    default: z.unknown().optional(),
    options: z.array(z.string()).optional(),
    accepts: z.array(z.string()).optional(),
    storage: z.string().optional(),
    referenceModelKey: z.string().optional(),
    fields: z.object({}).catchall(cmsFieldDefinitionSchema).optional(),
    item: cmsFieldDefinitionSchema.optional(),
  }),
);

const cmsEntryFieldUpdateSchema = z.object({
  modelKey: z.string().min(1),
  entryKey: z.string().min(1),
  fieldPath: z
    .array(z.union([z.string().min(1), z.number().int().nonnegative()]))
    .min(1),
  value: z.unknown(),
  assetAction: z
    .object({
      kind: z.literal("copy-to-entry"),
      sourcePath: z.string().min(1),
    })
    .optional(),
});

const cmsTextFileWriteSchema = z.object({
  relativePath: z.string().min(1),
  content: z.string(),
});

export const cmsRouter = router({
  status: publicProcedure.query(async ({ ctx }) => {
    const projectDir = requireWorkspace(ctx);
    return validateCmsWorkspace(projectDir);
  }),

  init: publicProcedure.input(mutationInput).mutation(async ({ input, ctx }) => {
    const projectDir = requireWorkspace(ctx);
    const scaffold = await scaffoldCmsWorkspace(projectDir);
    const prepared = await prepareCmsArtifacts(projectDir);
    markCmsWorkspaceChange(input.slug, input.version, "cms-initialized");
    return {
      scaffold,
      ...prepared,
    };
  }),

  scaffoldModel: publicProcedure
    .input(
      mutationInput.extend({
        modelKey: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const projectDir = requireWorkspace(ctx);
      const scaffold = await scaffoldCmsModel(projectDir, input.modelKey);
      const prepared = await prepareCmsArtifacts(projectDir);
      markCmsWorkspaceChange(input.slug, input.version, "cms-model-scaffolded");
      return {
        scaffold,
        ...prepared,
      };
    }),

  scaffoldEntry: publicProcedure
    .input(
      mutationInput.extend({
        modelKey: z.string().min(1),
        entryKey: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const projectDir = requireWorkspace(ctx);
      const scaffold = await scaffoldCmsEntry(
        projectDir,
        input.modelKey,
        input.entryKey,
      );
      const prepared = await prepareCmsArtifacts(projectDir);
      markCmsWorkspaceChange(input.slug, input.version, "cms-entry-scaffolded");
      return {
        scaffold,
        ...prepared,
      };
    }),

  createEntry: publicProcedure
    .input(
      mutationInput.extend({
        modelKey: z.string().min(1),
        entryKey: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const projectDir = requireWorkspace(ctx);
      const created = await createCmsEntry(projectDir, input.modelKey, input.entryKey);
      const prepared = await prepareCmsArtifacts(projectDir);
      markCmsWorkspaceChange(input.slug, input.version, "cms-entry-created");
      return {
        created,
        ...prepared,
      };
    }),

  updateModel: publicProcedure
    .input(
      mutationInput.extend({
        modelKey: z.string().min(1),
        fields: z.object({}).catchall(cmsFieldDefinitionSchema),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const projectDir = requireWorkspace(ctx);
      const updated = await updateCmsModel(
        projectDir,
        input.modelKey,
        input.fields as Record<string, CmsFieldDefinition>,
      );
      const prepared = await prepareCmsArtifacts(projectDir);
      markCmsWorkspaceChange(input.slug, input.version, "cms-model-updated");
      return {
        updated,
        ...prepared,
      };
    }),

  applyPreviewFieldUpdates: publicProcedure
    .input(
      mutationInput.extend({
        updates: z.array(cmsEntryFieldUpdateSchema).min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const projectDir = requireWorkspace(ctx);
      const updates = await resolvePreviewAssetActions(
        projectDir,
        input.updates as CmsPreviewEntryFieldUpdate[],
      );
      const updated = await updateCmsEntryFields(
        projectDir,
        updates,
      );
      const prepared = await prepareCmsArtifacts(projectDir);
      markCmsWorkspaceChange(input.slug, input.version, "cms-preview-updated");
      return {
        updated,
        ...prepared,
      };
    }),

  saveEntry: publicProcedure
    .input(
      mutationInput.extend({
        relativePath: z.string().min(1),
        content: z.string(),
        sidecars: z.array(cmsTextFileWriteSchema).default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const projectDir = requireWorkspace(ctx);
      const { saved, result: prepared } = await runCmsTextFileTransaction(
        projectDir,
        [
          {
            relativePath: input.relativePath,
            content: input.content,
          },
          ...input.sidecars,
        ],
        async () => prepareCmsArtifacts(projectDir),
      );
      markCmsWorkspaceChange(input.slug, input.version, "cms-entry-saved");
      return {
        saved,
        ...prepared,
      };
    }),

  prepare: publicProcedure.input(mutationInput).mutation(async ({ input, ctx }) => {
    const projectDir = requireWorkspace(ctx);
    const prepared = await prepareCmsArtifacts(projectDir);
    if (prepared.built) {
      markCmsWorkspaceChange(input.slug, input.version, "cms-artifacts-built");
    }
    return prepared;
  }),
});
