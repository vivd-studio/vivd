export interface ContactFormAutoSourceHostsDeps {
  listPublishedSiteDomains(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<string[]>;
  listTenantHostDomains(options: {
    organizationId: string;
  }): Promise<string[]>;
  nodeEnv?: string | null;
  flyStudioPublicHost?: string | null;
  flyStudioApp?: string | null;
}

export async function inferContactFormAutoSourceHosts(
  options: {
    organizationId: string;
    projectSlug: string;
  },
  deps: ContactFormAutoSourceHostsDeps,
): Promise<string[]> {
  const [publishedDomains, tenantDomains] = await Promise.all([
    deps.listPublishedSiteDomains(options),
    deps.listTenantHostDomains({ organizationId: options.organizationId }),
  ]);

  const hosts = new Set<string>();
  for (const domain of publishedDomains) hosts.add(domain);
  for (const domain of tenantDomains) hosts.add(domain);

  if ((deps.nodeEnv || process.env.NODE_ENV || "").toLowerCase() !== "production") {
    hosts.add("localhost");
    hosts.add("127.0.0.1");
    hosts.add("[::1]");
  }

  const studioPublicHost = (
    deps.flyStudioPublicHost ||
    process.env.FLY_STUDIO_PUBLIC_HOST ||
    ((deps.flyStudioApp || process.env.FLY_STUDIO_APP || "").trim()
      ? `${(deps.flyStudioApp || process.env.FLY_STUDIO_APP || "").trim()}.fly.dev`
      : "")
  ).trim();
  if (studioPublicHost) {
    hosts.add(studioPublicHost);
  }

  return [...hosts].sort();
}
