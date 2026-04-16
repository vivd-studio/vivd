import {
  installedPluginManifests,
  type InstalledPluginId,
} from "@vivd/installed-plugins";
import { analyticsBackendHostPlugin } from "./analytics/hostPlugin";
import { contactFormBackendHostPlugin } from "./contactForm/hostPlugin";
import { newsletterBackendHostPlugin } from "./newsletter/hostPlugin";

const backendPluginHostRegistrationsById = {
  contact_form: contactFormBackendHostPlugin,
  analytics: analyticsBackendHostPlugin,
  newsletter: newsletterBackendHostPlugin,
} as const satisfies Record<InstalledPluginId, unknown>;

export const installedBackendPluginHostRegistrations =
  installedPluginManifests.map((manifest) => ({
    manifest,
    registration:
      backendPluginHostRegistrationsById[
        manifest.pluginId as keyof typeof backendPluginHostRegistrationsById
      ],
  }));
