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
      const updated = await updateCmsEntryFields(
        projectDir,
        input.updates as CmsEntryFieldUpdate[],
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
