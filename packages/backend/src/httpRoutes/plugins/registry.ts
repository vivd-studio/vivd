import type express from "express";
import {
  listBackendPublicPluginRouteDefinitions,
  type PublicPluginRouterDeps,
} from "../../services/plugins/descriptors";

export type { PublicPluginRouterDeps } from "../../services/plugins/descriptors";

interface PublicPluginRouteRegistrationDefinition {
  routeId: string;
  mountPath: string;
  createRouter: (deps: PublicPluginRouterDeps) => express.Router;
}

export interface PublicPluginRouteRegistration {
  routeId: string;
  mountPath: string;
  router: express.Router;
}

const publicPluginRouteDefinitions: PublicPluginRouteRegistrationDefinition[] =
  listBackendPublicPluginRouteDefinitions();

export function listPublicPluginRouteRegistrations(
  deps: PublicPluginRouterDeps,
): PublicPluginRouteRegistration[] {
  return publicPluginRouteDefinitions.map((definition) => ({
    routeId: definition.routeId,
    mountPath: definition.mountPath,
    router: definition.createRouter(deps),
  }));
}
