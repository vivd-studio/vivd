import { z } from "zod";
import { studioProjectProcedure } from "../../trpc";
import { projectMetaService } from "../../services/project/ProjectMetaService";
import { studioAgentLeaseService } from "../../services/project/StudioAgentLeaseService";
import { studioMachineProvider } from "../../services/studioMachines";
import type { ChecklistStatus } from "../../types/checklistTypes";
import { normalizeChecklistItemNote, summarizeChecklistItems } from "./shared";
import { prePublishChecklistSchema } from "./schemas";

export const studioApiChecklistLeaseProcedures = {
  reportAgentTaskLease: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string().min(1),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        sessionId: z.string().min(1),
        runId: z.string().min(1),
        state: z.enum(["active", "idle"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;

      if (input.state === "idle") {
        studioAgentLeaseService.reportIdle({
          organizationId,
          slug: input.slug,
          version: input.version,
          runId: input.runId,
        });
        return {
          success: true,
          keepalive: false,
          leaseState: "idle" as const,
        };
      }

      const lease = studioAgentLeaseService.reportActive({
        organizationId,
        slug: input.slug,
        version: input.version,
        studioId: input.studioId,
        sessionId: input.sessionId,
        runId: input.runId,
      });

      if (lease.leaseState === "active") {
        try {
          await studioMachineProvider.touch(
            organizationId,
            input.slug,
            input.version,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[StudioAPI] Failed to touch machine for active agent lease ${organizationId}:${input.slug}/v${input.version}: ${message}`,
          );
        }
      } else {
        console.warn(
          `[StudioAPI] Agent lease max exceeded for ${organizationId}:${input.slug}/v${input.version} session=${input.sessionId} run=${input.runId} ageMs=${lease.ageMs}`,
        );
      }

      return {
        success: true,
        keepalive: lease.leaseState === "active",
        leaseState: lease.leaseState,
      };
    }),

  upsertPublishChecklist: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        checklist: prePublishChecklistSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await projectMetaService.upsertPublishChecklist({
        organizationId: ctx.organizationId!,
        checklist: {
          ...input.checklist,
          projectSlug: input.slug,
          version: input.version,
        },
      });
      return { success: true };
    }),

  getPublishChecklist: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const checklist = await projectMetaService.getPublishChecklist({
        organizationId: ctx.organizationId!,
        slug: input.slug,
        version: input.version,
      });
      return { checklist };
    }),

  updatePublishChecklistItem: studioProjectProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
        itemId: z.string().min(1),
        status: z.enum(["pass", "fail", "warning", "skip", "fixed"]),
        note: z.string().max(4_000).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const existing = await projectMetaService.getPublishChecklist({
        organizationId,
        slug: input.slug,
        version: input.version,
      });

      if (!existing) {
        throw new Error(
          "No publish checklist exists for this project version. Run the checklist first.",
        );
      }

      const itemIndex = existing.items.findIndex((item) => item.id === input.itemId);
      if (itemIndex < 0) {
        throw new Error(
          `Unknown checklist item "${input.itemId}" for this project version.`,
        );
      }

      const note = normalizeChecklistItemNote(input.note);
      const updatedItems = existing.items.map((item, index) => {
        if (index !== itemIndex) return item;
        return {
          ...item,
          status: input.status as ChecklistStatus,
          note,
        };
      });
      const summary = summarizeChecklistItems(updatedItems);
      const checklist = {
        ...existing,
        projectSlug: input.slug,
        version: input.version,
        runAt: new Date().toISOString(),
        items: updatedItems,
        summary,
      };

      await projectMetaService.upsertPublishChecklist({
        organizationId,
        checklist,
      });

      return {
        checklist,
        item: checklist.items[itemIndex],
      };
    }),
};
