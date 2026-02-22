import express from "express";
import {
  createContactFormPublicRouter,
  type ContactFormPublicRouterDeps,
} from "./contactForm/submit";
import { createAnalyticsPublicRouter } from "./analytics/runtime";

export function createPublicPluginsRouter(
  deps: ContactFormPublicRouterDeps,
) {
  const router = express.Router();
  router.use("/plugins", createAnalyticsPublicRouter(deps));
  router.use("/plugins", createContactFormPublicRouter(deps));
  return router;
}
