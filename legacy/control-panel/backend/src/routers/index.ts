import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getInstanceManager } from "../services/instance-manager.js";
import { getDokployService } from "../services/dokploy.js";
import { ownerProcedure, router } from "../trpc.js";
import { userRouter } from "./user.js";

// Instance router
export const instanceRouter = router({
  // List all instances
  list: ownerProcedure.query(async () => {
    const manager = getInstanceManager();
    return manager.listInstancesWithStatusSync();
  }),

  // Get a specific instance
  get: ownerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const manager = getInstanceManager();
      const instance = await manager.getInstance(input.id);
      if (!instance) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Instance ${input.id} not found`,
        });
      }
      return instance;
    }),

  // Get instance by slug
  getBySlug: ownerProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const manager = getInstanceManager();
      const instance = await manager.getInstanceBySlug(input.slug);
      if (!instance) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Instance with slug ${input.slug} not found`,
        });
      }
      return instance;
    }),

  // Create a new instance
  create: ownerProcedure
    .input(
      z.object({
        name: z.string().min(1, "Name is required"),
        slug: z.string().optional(),
        domain: z.string().min(1, "Domain is required"),
        singleProjectMode: z.boolean().optional().default(false),
        githubRepoPrefix: z.string().optional(),
        opencodeModel: z.string().optional(),
        openrouterApiKey: z.string().optional(),
        googleApiKey: z.string().optional(),
        githubToken: z.string().optional(),
        scraperUrl: z.string().optional(),
        scraperApiKey: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const manager = getInstanceManager();
      return manager.createInstance(input);
    }),

  // Redeploy an instance
  redeploy: ownerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const manager = getInstanceManager();
      await manager.redeployInstance(input.id);
      return { success: true };
    }),

  // Delete an instance
  delete: ownerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const manager = getInstanceManager();
      await manager.deleteInstance(input.id);
      return { success: true };
    }),

  // Sync instance status from Dokploy
  syncStatus: ownerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const manager = getInstanceManager();
      return manager.syncInstanceStatus(input.id);
    }),
});

// Health/status router
export const statusRouter = router({
  // Check Dokploy connection
  dokployHealth: ownerProcedure.query(async () => {
    try {
      const dokploy = getDokployService();
      const isHealthy = await dokploy.healthCheck();
      return {
        connected: isHealthy,
        url: process.env.DOKPLOY_URL,
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }),

  // Get control panel version
  version: ownerProcedure.query(() => ({
    version: process.env.npm_package_version || "0.1.0",
    nodeVersion: process.version,
  })),
});

// Main app router
export const appRouter = router({
  instances: instanceRouter,
  health: statusRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
