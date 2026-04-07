import express from "express";
import {
  listPublicPluginRouteRegistrations,
  type PublicPluginRouterDeps,
} from "./registry";

/**
 * Public plugin endpoints are called cross-origin from customer websites,
 * so they need permissive CORS (Access-Control-Allow-Origin: *).
 * This router is mounted BEFORE the global restrictive CORS middleware
 * in server.ts so that plugin requests are handled entirely here.
 */
export function createPublicPluginsRouter(
  deps: PublicPluginRouterDeps,
) {
  const router = express.Router();

  // Permissive CORS for all public plugin endpoints
  router.use("/plugins", (req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Accept");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });

  for (const registration of listPublicPluginRouteRegistrations(deps)) {
    router.use(registration.mountPath, registration.router);
  }
  return router;
}
