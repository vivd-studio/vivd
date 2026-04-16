import {
  installedPluginManifests,
  type InstalledPluginId,
} from "@vivd/installed-plugins";
import { analyticsBackendHostPlugin } from "./analytics/hostPlugin";
import { contactFormBackendHostPlugin } from "./contactForm/hostPlugin";
import { newsletterBackendHostPlugin } from "./newsletter/hostPlugin";
import { tableBookingBackendHostPlugin } from "./tableBooking/hostPlugin";

interface BackendPluginHostRegistration {
  pluginId: InstalledPluginId;
  createContribution(options: { pluginEntitlementService: unknown }): unknown;
}

const backendPluginHostRegistrationsById = {
  contact_form: contactFormBackendHostPlugin,
  analytics: analyticsBackendHostPlugin,
  newsletter: newsletterBackendHostPlugin,
  table_booking: tableBookingBackendHostPlugin,
} as const satisfies Partial<
  Record<InstalledPluginId, BackendPluginHostRegistration>
>;

export const installedBackendPluginHostRegistrations =
  installedPluginManifests.flatMap((manifest) => {
    const registration =
      backendPluginHostRegistrationsById[
        manifest.pluginId as keyof typeof backendPluginHostRegistrationsById
      ];

    return registration
      ? [
          {
            manifest,
            registration,
          },
        ]
      : [];
  });
