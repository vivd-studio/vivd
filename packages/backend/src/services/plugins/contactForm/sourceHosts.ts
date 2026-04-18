import { and, eq } from "drizzle-orm";
import {
  inferContactFormAutoSourceHosts as inferPluginContactFormAutoSourceHosts,
} from "@vivd/plugin-contact-form/backend/sourceHosts";
import { db } from "../../../db";
import { domain as domainTable, publishedSite } from "../../../db/schema";
import { installProfileService } from "../../system/InstallProfileService";

// Hosted Studio preview uses one stable Fly app hostname even as preview ports vary.
export const PLATFORM_STUDIO_PREVIEW_HOST = "vivd-studio-prod.fly.dev";

export async function inferContactFormAutoSourceHosts(options: {
  organizationId: string;
  projectSlug: string;
}): Promise<string[]> {
  const [hosts, installProfile] = await Promise.all([
    inferPluginContactFormAutoSourceHosts(options, {
      async listPublishedSiteDomains(hostOptions) {
        const rows = await db.query.publishedSite.findMany({
          where: and(
            eq(publishedSite.organizationId, hostOptions.organizationId),
            eq(publishedSite.projectSlug, hostOptions.projectSlug),
          ),
          columns: {
            domain: true,
          },
        });

        return rows.map((row) => row.domain);
      },
      async listTenantHostDomains(hostOptions) {
        const rows = await db.query.domain.findMany({
          where: and(
            eq(domainTable.organizationId, hostOptions.organizationId),
            eq(domainTable.usage, "tenant_host"),
            eq(domainTable.status, "active"),
          ),
          columns: {
            domain: true,
          },
        });

        return rows.map((row) => row.domain);
      },
      nodeEnv: process.env.NODE_ENV,
      flyStudioPublicHost: process.env.FLY_STUDIO_PUBLIC_HOST,
      flyStudioApp: process.env.FLY_STUDIO_APP,
    }),
    installProfileService.getInstallProfile(),
  ]);

  if (installProfile !== "platform") {
    return hosts;
  }

  return Array.from(new Set([...hosts, PLATFORM_STUDIO_PREVIEW_HOST])).sort();
}
