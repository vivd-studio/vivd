/**
 * Type-only router definition for the Control Panel API
 *
 * This mirrors the backend router structure without service dependencies,
 * allowing the frontend to have proper tRPC type inference in Docker builds.
 *
 * IMPORTANT: Keep this in sync with backend/src/routers/index.ts
 */

import { initTRPC } from "@trpc/server";
import { z } from "zod";
import superjson from "superjson";

// Create a type-only tRPC instance (same config as real router)
const t = initTRPC.create({
  transformer: superjson,
});

const router = t.router;
const publicProcedure = t.procedure;

// Instance status type
const instanceStatusSchema = z.enum([
  "active",
  "stopped",
  "error",
  "deploying",
]);

// Instance schema (matches database schema)
const instanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  domain: z.string(),
  status: instanceStatusSchema,
  singleProjectMode: z.boolean(),
  githubRepoPrefix: z.string().nullable(),
  dokployProjectId: z.string().nullable(),
  dokployComposeId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Create instance input schema
const createInstanceSchema = z.object({
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
});

// Instance router type definition
const instanceRouter = router({
  list: publicProcedure.query(() => [] as z.infer<typeof instanceSchema>[]),
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(() => ({} as z.infer<typeof instanceSchema>)),
  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(() => ({} as z.infer<typeof instanceSchema>)),
  create: publicProcedure
    .input(createInstanceSchema)
    .mutation(() => ({} as z.infer<typeof instanceSchema>)),
  redeploy: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(() => ({ success: true })),
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(() => ({ success: true })),
  syncStatus: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(() => ({} as z.infer<typeof instanceSchema>)),
});

// Health router type definition
const statusRouter = router({
  dokployHealth: publicProcedure.query(() => ({
    connected: true as boolean,
    url: "" as string | undefined,
    error: undefined as string | undefined,
  })),
  version: publicProcedure.query(() => ({
    version: "",
    nodeVersion: "",
  })),
});

// User router type definition
const userRouter = router({
  hasUsers: publicProcedure.query(() => ({ hasUsers: true as boolean })),
  me: publicProcedure.query(() => ({
    user: {
      id: "" as string,
      email: "" as string,
      name: "" as string,
      role: "" as string,
    },
  })),
});

// Main app router (type matches the real router exactly)
const appRouter = router({
  instances: instanceRouter,
  health: statusRouter,
  user: userRouter,
});

// Export the router type
export type AppRouter = typeof appRouter;

// Export helper types for component use
export type Instance = z.infer<typeof instanceSchema>;
export type InstanceStatus = z.infer<typeof instanceStatusSchema>;
export type CreateInstanceInput = z.infer<typeof createInstanceSchema>;
