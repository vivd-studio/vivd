import "./init-env";
import express from "express";
import cors from "cors";
import multer from "multer";

import { toNodeHandler } from "better-auth/node";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { auth } from "./auth";
import { appRouter } from "./trpcRouters/appRouter";
import { createContext } from "./trpc";
import { createImportRouter } from "./httpRoutes/import";
import { db } from "./db";
import { organizationMember, projectMember } from "./db/schema";
import { and, eq } from "drizzle-orm";
import { domainService } from "./services/publish/DomainService";
import { startStudioMachineReconciler } from "./services/studioMachines";
import { createPublicPluginsRouter } from "./httpRoutes/plugins";
import { startContactSubmissionRetentionJob } from "./services/plugins/contactForm/retention";
import { createProjectRuntimeRouter } from "./httpRoutes/projectRuntime";

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_ZIP_IMPORT_MAX_FILE_SIZE_MB = 250;
const parsedZipImportMaxFileSizeMb = Number.parseInt(
  process.env.ZIP_IMPORT_MAX_FILE_SIZE_MB || "",
  10,
);
const ZIP_IMPORT_MAX_FILE_SIZE_MB =
  Number.isFinite(parsedZipImportMaxFileSizeMb) && parsedZipImportMaxFileSizeMb > 0
    ? parsedZipImportMaxFileSizeMb
    : DEFAULT_ZIP_IMPORT_MAX_FILE_SIZE_MB;

function getRequestHostHeader(req: express.Request): string | null {
  const raw = req.headers.host;
  if (!raw) return null;
  return raw.split(",")[0]?.trim() ?? null;
}

function isSuperAdminHost(req: express.Request): boolean {
  return domainService.isSuperAdminHost(getRequestHostHeader(req));
}

async function getSessionOrganizationRole(
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const membership = await db.query.organizationMember.findFirst({
    where: and(
      eq(organizationMember.organizationId, organizationId),
      eq(organizationMember.userId, userId),
    ),
    columns: { role: true },
  });
  return membership?.role ?? null;
}

async function getAssignedProjectSlug(
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const membership = await db.query.projectMember.findFirst({
    where: and(
      eq(projectMember.organizationId, organizationId),
      eq(projectMember.userId, userId),
    ),
  });
  return membership?.projectSlug ?? null;
}

async function enforceProjectAccess(
  _req: express.Request,
  res: express.Response,
  session: any,
  organizationId: string,
  slug: string,
): Promise<boolean> {
  const role = await getSessionOrganizationRole(organizationId, session.user.id);
  if (role !== "client_editor") return true;

  const assigned = await getAssignedProjectSlug(organizationId, session.user.id);
  if (!assigned) {
    res.status(403).json({ error: "No project assigned to your account" });
    return false;
  }
  if (assigned !== slug) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

// ZIP project imports are larger than regular asset uploads.
const zipImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: ZIP_IMPORT_MAX_FILE_SIZE_MB * 1024 * 1024,
  },
});

app.use(
  cors({
    origin: process.env.DOMAIN
      ? process.env.DOMAIN.startsWith("http")
        ? process.env.DOMAIN
        : `https://${process.env.DOMAIN}`
      : "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "50mb" }));

// Auth Routes
const authHandler = toNodeHandler(auth);
app.all("/vivd-studio/api/auth/*path", async (req, res) => {
  // Host-gate Better Auth admin endpoints so they aren't reachable from customer domains.
  if (
    (req.path === "/vivd-studio/api/auth/admin" ||
      req.path.startsWith("/vivd-studio/api/auth/admin/")) &&
    !isSuperAdminHost(req)
  ) {
    return res.status(404).json({ error: "Not found" });
  }

  return authHandler(req, res);
});

app.use(
  createProjectRuntimeRouter({
    upload,
    createContext,
    enforceProjectAccess,
  }),
);

// Import Projects endpoint(s)
app.use("/vivd-studio/api", createImportRouter({ auth, upload: zipImportUpload }));

// Public plugin runtime endpoints
app.use(createPublicPluginsRouter({ upload }));

// tRPC
app.use(
  "/vivd-studio/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

app.get("/vivd-studio/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, async () => {
  try {
    await domainService.backfillPublishedDomainsIntoRegistry();
    await domainService.ensureManagedTenantDomainsForExistingOrganizations();
    console.log("[DomainService] Domain registry backfill complete");
  } catch (error) {
    console.error("[DomainService] Failed to backfill domain registry:", error);
  }

  console.log(`Server running on port ${PORT}`);

  startStudioMachineReconciler();
  const stopContactSubmissionRetention = startContactSubmissionRetentionJob();
  let hasShutdown = false;

  const cleanup = () => {
    if (hasShutdown) return;
    hasShutdown = true;
    stopContactSubmissionRetention();
    console.log("[Server] Shutting down...");
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("exit", cleanup);
});
