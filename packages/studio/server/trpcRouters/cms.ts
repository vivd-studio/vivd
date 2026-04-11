import { z } from "zod";
import {
  scaffoldCmsEntry,
  scaffoldCmsModel,
  scaffoldCmsWorkspace,
  validateCmsWorkspace,
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

  prepare: publicProcedure.input(mutationInput).mutation(async ({ input, ctx }) => {
    const projectDir = requireWorkspace(ctx);
    const prepared = await prepareCmsArtifacts(projectDir);
    if (prepared.built) {
      markCmsWorkspaceChange(input.slug, input.version, "cms-artifacts-built");
    }
    return prepared;
  }),
});
