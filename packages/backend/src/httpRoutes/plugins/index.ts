import express from "express";
import {
  createContactFormPublicRouter,
  type ContactFormPublicRouterDeps,
} from "./contactForm/submit";
import { createAnalyticsPublicRouter } from "./analytics/runtime";

/**
 * Public plugin endpoints are called cross-origin from customer websites,
 * so they need permissive CORS (Access-Control-Allow-Origin: *).
 * This router is mounted BEFORE the global restrictive CORS middleware
 * in server.ts so that plugin requests are handled entirely here.
 */
export function createPublicPluginsRouter(
  deps: ContactFormPublicRouterDeps,
) {
  const router = express.Router();

  // Permissive CORS for all public plugin endpoints
  router.use("/plugins", (req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Accept");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });

  router.use("/plugins", createAnalyticsPublicRouter(deps));
  router.use("/plugins", createContactFormPublicRouter(deps));
  return router;
}
