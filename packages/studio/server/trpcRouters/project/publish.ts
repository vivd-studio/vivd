import { z } from "zod";
import { isConnectedMode } from "@vivd/shared";
import { publicProcedure } from "../../trpc/trpc.js";
import { callConnectedBackendMutation, callConnectedBackendQuery } from "../project.shared.js";
import { readProjectSlugFromEnv } from "./env.js";
import type {
  ConnectedCheckDomainResult,
  ConnectedPublishChecklist,
  ConnectedPublishState,
  ConnectedPublishTargetsResult,
} from "./types.js";

export const projectPublishProcedures = {
  publishStatus: publicProcedure
    .input(
      z.object({
        slug: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (isConnectedMode()) {
        try {
          const result = await callConnectedBackendQuery<{
            isPublished: boolean;
            domain: string | null;
            commitHash: string | null;
            publishedAt: string | null;
            url: string | null;
            projectVersion?: number | null;
          }>(ctx, "project.publishStatus", { slug: input.slug });

          return {
            mode: "connected" as const,
            ...result,
            lastTag: null,
          };
        } catch (err) {
          console.error("Connected publish status failed:", err);
        }
      }

      try {
        const tags = await ctx.workspace.getTags?.();
        const lastTag = tags?.[0] || null;
        return {
          mode: "standalone" as const,
          isPublished: tags && tags.length > 0,
          lastTag,
          domain: null,
          commitHash: null,
          publishedAt: null,
          url: null,
        };
      } catch (err) {
        console.error("Error fetching publish status:", err);
        return {
          mode: "standalone" as const,
          isPublished: false,
          lastTag: null,
          domain: null,
          commitHash: null,
          publishedAt: null,
          url: null,
        };
      }
    }),

  publishState: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (isConnectedMode()) {
        return await callConnectedBackendQuery<ConnectedPublishState>(
          ctx,
          "project.publishState",
          {
            slug: input.slug,
            version: input.version,
          },
        );
      }

      const head = await ctx.workspace.getHeadCommit();
      return {
        storageEnabled: false,
        readiness: "ready" as const,
        sourceKind: "source" as const,
        framework: "generic" as const,
        publishableCommitHash: head?.hash || null,
        lastSyncedCommitHash: head?.hash || null,
        builtAt: null,
        sourceBuiltAt: null,
        previewBuiltAt: null,
        error: null,
        studioRunning: true,
        studioStateAvailable: true,
        studioHasUnsavedChanges: false,
        studioHeadCommitHash: head?.hash || null,
        studioWorkingCommitHash: null,
        studioStateReportedAt: new Date().toISOString(),
      };
    }),

  publishChecklist: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (isConnectedMode()) {
        return await callConnectedBackendQuery<ConnectedPublishChecklist>(
          ctx,
          "project.publishChecklist",
          {
            slug: input.slug,
            version: input.version,
          },
        );
      }

      return {
        checklist: null,
        stale: true,
        reason: "missing" as const,
      };
    }),

  publishTargets: publicProcedure
    .input(
      z.object({
        slug: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (isConnectedMode()) {
        return await callConnectedBackendQuery<ConnectedPublishTargetsResult>(
          ctx,
          "project.publishTargets",
          {
            slug: input.slug,
          },
        );
      }

      return {
        projectSlug: input.slug,
        currentPublishedDomain: null,
        recommendedDomain: null,
        targets: [],
      };
    }),

  checkDomain: publicProcedure
    .input(
      z.object({
        domain: z.string(),
        slug: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (isConnectedMode()) {
        return await callConnectedBackendQuery<ConnectedCheckDomainResult>(
          ctx,
          "project.checkDomain",
          {
            ...input,
            slug: input.slug ?? readProjectSlugFromEnv() ?? undefined,
          },
        );
      }

      const normalizedDomain = input.domain.toLowerCase().trim();
      return {
        available: true,
        normalizedDomain,
      };
    }),

  publish: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        domain: z.string(),
        expectedCommitHash: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isConnectedMode()) {
        throw new Error("Publishing via domain is available in connected mode only.");
      }

      return await callConnectedBackendMutation(ctx, "project.publish", input);
    }),

  unpublish: publicProcedure
    .input(
      z.object({
        slug: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isConnectedMode()) {
        throw new Error("Unpublish is available in connected mode only.");
      }

      return await callConnectedBackendMutation(ctx, "project.unpublish", input);
    }),

  setPublicPreviewEnabled: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isConnectedMode()) {
        throw new Error("Not available in standalone mode");
      }

      return await callConnectedBackendMutation<{
        publicPreviewEnabled: boolean;
      }>(ctx, "project.setPublicPreviewEnabled", input);
    }),

  regenerateThumbnail: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isConnectedMode()) {
        throw new Error("Not available in standalone mode");
      }

      return await callConnectedBackendMutation(
        ctx,
        "project.regenerateThumbnail",
        input,
      );
    }),

  deleteProject: publicProcedure
    .input(
      z.object({
        slug: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isConnectedMode()) {
        throw new Error("Not available in standalone mode");
      }

      return await callConnectedBackendMutation(ctx, "project.delete", input);
    }),
};
