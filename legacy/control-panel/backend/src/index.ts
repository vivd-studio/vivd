import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { appRouter } from "./routers/index.js";
import { createContext } from "./trpc.js";

const app = express();
const PORT = process.env.PORT || 3100;

app.use(express.json({ limit: "10mb" }));

// Health check endpoint
app.get("/health", (_, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Auth Routes (Better Auth)
app.all("/auth/*path", toNodeHandler(auth));

// tRPC API
app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Control Panel API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   tRPC:   http://localhost:${PORT}/trpc`);
});
