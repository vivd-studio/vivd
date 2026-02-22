import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { domain as domainTable, publishedSite } from "../../../db/schema";

export async function inferContactFormAutoSourceHosts(options: {
  organizationId: string;
  projectSlug: string;
}): Promise<string[]> {
  const [publishedRows, tenantRows] = await Promise.all([
    db.query.publishedSite.findMany({
      where: and(
        eq(publishedSite.organizationId, options.organizationId),
        eq(publishedSite.projectSlug, options.projectSlug),
      ),
      columns: {
        domain: true,
      },
    }),
    db.query.domain.findMany({
      where: and(
        eq(domainTable.organizationId, options.organizationId),
        eq(domainTable.usage, "tenant_host"),
        eq(domainTable.status, "active"),
      ),
      columns: {
        domain: true,
      },
    }),
  ]);

  const hosts = new Set<string>();
  for (const row of publishedRows) hosts.add(row.domain);
  for (const row of tenantRows) hosts.add(row.domain);

  if ((process.env.NODE_ENV || "").toLowerCase() !== "production") {
    hosts.add("localhost");
    hosts.add("127.0.0.1");
    hosts.add("[::1]");
  }

  // Add the studio machine's public host so Turnstile works during in-studio dev previews.
  // Studio machines serve the user's dev preview at this host (e.g. vivd-studios.fly.dev),
  // which must be an allowed Turnstile domain or the widget fails with error 110200.
  const studioPublicHost = (
    process.env.FLY_STUDIO_PUBLIC_HOST ||
    ((process.env.FLY_STUDIO_APP || "").trim()
      ? `${process.env.FLY_STUDIO_APP!.trim()}.fly.dev`
      : "")
  ).trim();
  if (studioPublicHost) {
    hosts.add(studioPublicHost);
  }

  return [...hosts].sort();
}
