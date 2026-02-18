type Semver = { major: number; minor: number; patch: number };

function parseSemverTag(tag: string): { version: Semver; normalized: string } | null {
  const match = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if (![major, minor, patch].every((n) => Number.isFinite(n) && n >= 0)) {
    return null;
  }

  return {
    version: { major, minor, patch },
    normalized: `${major}.${minor}.${patch}`,
  };
}

function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function pickLatestSemverTag(tags: string[]): string | null {
  const byVersion = new Map<
    string,
    { version: Semver; tagWithV?: string; tagNoV?: string }
  >();

  for (const tag of tags) {
    const parsed = parseSemverTag(tag);
    if (!parsed) continue;
    const entry = byVersion.get(parsed.normalized) || { version: parsed.version };
    if (tag.startsWith("v")) {
      entry.tagWithV = tag;
    } else {
      entry.tagNoV = tag;
    }
    byVersion.set(parsed.normalized, entry);
  }

  let best: { version: Semver; tag: string } | null = null;
  for (const entry of byVersion.values()) {
    const tag = entry.tagNoV || entry.tagWithV;
    if (!tag) continue;

    if (!best || compareSemver(entry.version, best.version) > 0) {
      best = { version: entry.version, tag };
    }
  }

  return best?.tag || null;
}

export function normalizeGhcrRepository(input: string): { ownerRepo: string; imageBase: string } {
  let value = input.trim();

  if (value.startsWith("https://")) value = value.slice("https://".length);
  if (value.startsWith("http://")) value = value.slice("http://".length);

  // Allow passing full image refs (strip tag/digest).
  value = value.split("@")[0];
  const lastSlash = value.lastIndexOf("/");
  const lastColon = value.lastIndexOf(":");
  if (lastColon > lastSlash) value = value.slice(0, lastColon);

  if (value.startsWith("ghcr.io/")) value = value.slice("ghcr.io/".length);
  if (!value.includes("/")) {
    throw new Error(
      `[FlyMachines] Invalid GHCR repository "${input}". Expected "owner/repo" or "ghcr.io/owner/repo".`,
    );
  }

  return { ownerRepo: value, imageBase: `ghcr.io/${value}` };
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGhcrPullToken(options: {
  ownerRepo: string;
  timeoutMs: number;
}): Promise<string> {
  const tokenUrl = new URL("https://ghcr.io/token");
  tokenUrl.searchParams.set("service", "ghcr.io");
  tokenUrl.searchParams.set("scope", `repository:${options.ownerRepo}:pull`);

  const data = await fetchJsonWithTimeout<{ token?: string }>(
    tokenUrl.toString(),
    { method: "GET" },
    options.timeoutMs,
  );
  if (!data.token) throw new Error("Missing token in GHCR response");
  return data.token;
}

async function fetchGhcrTags(options: {
  ownerRepo: string;
  token: string;
  timeoutMs: number;
}): Promise<string[]> {
  const tagsUrl = `https://ghcr.io/v2/${options.ownerRepo}/tags/list`;
  const data = await fetchJsonWithTimeout<{ tags?: string[] }>(
    tagsUrl,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${options.token}`,
      },
    },
    options.timeoutMs,
  );

  if (!Array.isArray(data.tags)) return [];
  return data.tags.filter((tag): tag is string => typeof tag === "string");
}

export async function resolveLatestSemverImageFromGhcr(options: {
  repository: string;
  timeoutMs: number;
}): Promise<string> {
  const { ownerRepo, imageBase } = normalizeGhcrRepository(options.repository);
  const token = await fetchGhcrPullToken({
    ownerRepo,
    timeoutMs: options.timeoutMs,
  });
  const tags = await fetchGhcrTags({
    ownerRepo,
    token,
    timeoutMs: options.timeoutMs,
  });

  const latestTag = pickLatestSemverTag(tags);
  if (!latestTag) {
    throw new Error(
      `No semver tags found for GHCR repository ${ownerRepo} (tags=${tags.length})`,
    );
  }

  return `${imageBase}:${latestTag}`;
}

export type GhcrStudioImage = {
  tag: string;
  kind: "semver" | "dev";
  version: string;
  image: string;
};

export async function listStudioImagesFromGhcr(options: {
  repository: string;
  timeoutMs: number;
  semverLimit?: number;
  devLimit?: number;
}): Promise<{ imageBase: string; images: GhcrStudioImage[] }> {
  const { ownerRepo, imageBase } = normalizeGhcrRepository(options.repository);
  const token = await fetchGhcrPullToken({
    ownerRepo,
    timeoutMs: options.timeoutMs,
  });
  const tags = await fetchGhcrTags({
    ownerRepo,
    token,
    timeoutMs: options.timeoutMs,
  });

  const byVersion = new Map<
    string,
    { version: Semver; tagWithV?: string; tagNoV?: string }
  >();

  for (const tag of tags) {
    const parsed = parseSemverTag(tag);
    if (!parsed) continue;
    const entry = byVersion.get(parsed.normalized) || { version: parsed.version };
    if (tag.startsWith("v")) {
      entry.tagWithV = tag;
    } else {
      entry.tagNoV = tag;
    }
    byVersion.set(parsed.normalized, entry);
  }

  const candidates = Array.from(byVersion.entries()).flatMap(([normalized, entry]) => {
    const tag = entry.tagNoV || entry.tagWithV;
    if (!tag) return [];
    return [{ normalized, version: entry.version, tag }];
  });

  candidates.sort((a, b) => compareSemver(b.version, a.version));

  const semverLimit =
    typeof options.semverLimit === "number" && Number.isFinite(options.semverLimit)
      ? Math.max(0, Math.floor(options.semverLimit))
      : null;
  const limited =
    semverLimit === null
      ? candidates
      : semverLimit > 0
        ? candidates.slice(0, semverLimit)
        : [];

  const semverImages: GhcrStudioImage[] = limited.map((candidate) => ({
    tag: candidate.tag,
    kind: "semver",
    version: candidate.normalized,
    image: `${imageBase}:${candidate.tag}`,
  }));

  const devTags = tags.filter((tag) => tag.startsWith("dev-"));

  const devSemverByVersion = new Map<
    string,
    { version: Semver; tagWithV?: string; tagNoV?: string }
  >();

  for (const tag of devTags) {
    const parsed = parseSemverTag(tag.slice("dev-".length));
    if (!parsed) continue;
    const entry = devSemverByVersion.get(parsed.normalized) || { version: parsed.version };
    const suffix = tag.slice("dev-".length);
    if (suffix.startsWith("v")) {
      entry.tagWithV = tag;
    } else {
      entry.tagNoV = tag;
    }
    devSemverByVersion.set(parsed.normalized, entry);
  }

  const devSemverCandidates = Array.from(devSemverByVersion.entries()).flatMap(
    ([normalized, entry]) => {
      const tag = entry.tagNoV || entry.tagWithV;
      if (!tag) return [];
      return [{ normalized, version: entry.version, tag }];
    },
  );
  devSemverCandidates.sort((a, b) => compareSemver(b.version, a.version));

  const devOtherCandidates = devTags
    .filter((tag) => !parseSemverTag(tag.slice("dev-".length)))
    .sort((a, b) => b.localeCompare(a))
    .map((tag) => ({ tag, version: tag.slice("dev-".length) || "dev" }));

  const devCandidates = [
    ...devSemverCandidates.map((candidate) => ({
      tag: candidate.tag,
      version: candidate.normalized,
    })),
    ...devOtherCandidates,
  ];

  const devLimit =
    typeof options.devLimit === "number" && Number.isFinite(options.devLimit)
      ? Math.max(0, Math.floor(options.devLimit))
      : 50;
  const devLimited = devLimit > 0 ? devCandidates.slice(0, devLimit) : [];

  const devImages: GhcrStudioImage[] = devLimited.map((candidate) => ({
    tag: candidate.tag,
    kind: "dev",
    version: candidate.version,
    image: `${imageBase}:${candidate.tag}`,
  }));

  return { imageBase, images: [...semverImages, ...devImages] };
}

export async function listSemverImagesFromGhcr(options: {
  repository: string;
  timeoutMs: number;
  limit?: number;
}): Promise<{ imageBase: string; images: Array<Omit<GhcrStudioImage, "kind">> }> {
  const listed = await listStudioImagesFromGhcr({
    repository: options.repository,
    timeoutMs: options.timeoutMs,
    semverLimit: options.limit,
    devLimit: 0,
  });

  return {
    imageBase: listed.imageBase,
    images: listed.images
      .filter((image) => image.kind === "semver")
      .map((image) => ({
        tag: image.tag,
        version: image.version,
        image: image.image,
      })),
  };
}
