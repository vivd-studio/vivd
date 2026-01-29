import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import path from "path";
import { fileURLToPath } from "url";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";
import { WorkspaceManager } from "./workspace/WorkspaceManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3100", 10);
  const REPO_URL = process.env.REPO_URL;
  const GIT_TOKEN = process.env.GIT_TOKEN;
  const BRANCH = process.env.BRANCH || "main";

  // CORS for development
  app.use(cors());

  // Initialize workspace
  const workspace = new WorkspaceManager();

  if (REPO_URL) {
    console.log(`Cloning repository: ${REPO_URL}`);
    await workspace.clone(REPO_URL, GIT_TOKEN, BRANCH);
    console.log(`Repository cloned to: ${workspace.getProjectPath()}`);
  } else {
    console.log(
      "No REPO_URL provided. Running in development mode without git."
    );
  }

  // Health check endpoint for service discovery
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      initialized: workspace.isInitialized(),
    });
  });

  // TRPC middleware
  app.use(
    "/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: () => createContext(workspace),
    })
  );

  // Serve bundled client in production
  const clientPath = path.join(__dirname, "client");
  app.use(express.static(clientPath));

  // SPA fallback
  app.get("*", (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith("/trpc") || req.path.startsWith("/preview")) {
      return next();
    }
    res.sendFile(path.join(clientPath, "index.html"));
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down studio...");
    await workspace.cleanup();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  app.listen(PORT, () => {
    console.log(`Studio server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start studio server:", error);
  process.exit(1);
});
