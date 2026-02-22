import express from "express";
import {
  createContactFormPublicRouter,
  type ContactFormPublicRouterDeps,
} from "./contactForm/submit";

export function createPublicPluginsRouter(
  deps: ContactFormPublicRouterDeps,
) {
  const router = express.Router();
  router.use("/plugins", createContactFormPublicRouter(deps));
  return router;
}
