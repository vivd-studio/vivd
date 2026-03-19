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

const GHCR_MANIFEST_ACCEPT =
  "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json";

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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
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
  const headers = {
    Authorization: `Bearer ${options.token}`,
  };
  const collected = new Set<string>();
  const seenUrls = new Set<string>();
  const maxPages = 100;
  let pageCount = 0;
  let tagsUrl = new URL(`https://ghcr.io/v2/${options.ownerRepo}/tags/list`);
  tagsUrl.searchParams.set("n", "100");

  while (true) {
    const normalizedUrl = tagsUrl.toString();
    if (seenUrls.has(normalizedUrl)) break;
    seenUrls.add(normalizedUrl);

    const response = await fetchWithTimeout(
      normalizedUrl,
      {
        method: "GET",
        headers,
      },
      options.timeoutMs,
    );
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { tags?: string[] };
    if (Array.isArray(data.tags)) {
      for (const tag of data.tags) {
        if (typeof tag === "string") collected.add(tag);
      }
    }

    pageCount += 1;
    if (pageCount >= maxPages) break;

    const next = parseGhcrNextTagsUrl({
      currentUrl: normalizedUrl,
      linkHeader: response.headers.get("link"),
    });
    if (!next) break;
    tagsUrl = new URL(next);
  }

  return Array.from(collected);
}

function parseGhcrNextTagsUrl(options: {
  currentUrl: string;
  linkHeader: string | null;
}): string | null {
  const { currentUrl, linkHeader } = options;
  if (!linkHeader) return null;

  const entries = linkHeader.split(",");
  for (const entry of entries) {
    const match = entry.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (!match) continue;
    const nextRef = match[1]?.trim();
    if (!nextRef) continue;
    try {
      return new URL(nextRef, currentUrl).toString();
    } catch {
      return null;
    }
  }

  return null;
}

type SemverCandidate = {
  normalized: string;
  version: Semver;
  tags: string[];
};

type ReadySemverCandidate = {
  normalized: string;
  version: Semver;
  tag: string;
};

function buildSemverCandidates(tags: string[]): SemverCandidate[] {
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
    const tagsForVersion = [entry.tagNoV, entry.tagWithV].filter(
      (tag): tag is string => typeof tag === "string" && tag.length > 0,
    );
    if (tagsForVersion.length === 0) return [];
    return [{ normalized, version: entry.version, tags: tagsForVersion }];
  });

  candidates.sort((a, b) => compareSemver(b.version, a.version));
  return candidates;
}

function buildDevCandidates(tags: string[]): Array<{ tag: string; version: string }> {
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
    .map((tag) => ({ tag, version: tag.slice("dev-".length) || "dev" }));

  return [
    ...devSemverCandidates.map((candidate) => ({
      tag: candidate.tag,
      version: candidate.normalized,
    })),
    ...devOtherCandidates,
  ];
}

function normalizeLimit(value: number | undefined, fallback: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

async function ghcrTagHasManifest(options: {
  ownerRepo: string;
  token: string;
  tag: string;
  timeoutMs: number;
}): Promise<boolean> {
  const manifestUrl = `https://ghcr.io/v2/${options.ownerRepo}/manifests/${encodeURIComponent(
    options.tag,
  )}`;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    Accept: GHCR_MANIFEST_ACCEPT,
  };

  try {
    const head = await fetchWithTimeout(
      manifestUrl,
      {
        method: "HEAD",
        headers,
      },
      options.timeoutMs,
    );
    if (head.ok) return true;
    if (head.status !== 405) return false;
  } catch {
    return false;
  }

  try {
    const get = await fetchWithTimeout(
      manifestUrl,
      {
        method: "GET",
        headers,
      },
      options.timeoutMs,
    );
    void get.body?.cancel?.();
    return get.ok;
  } catch {
    return false;
  }
}

function createGhcrTagReadinessChecker(options: {
  ownerRepo: string;
  token: string;
  timeoutMs: number;
}): (tag: string) => Promise<boolean> {
  const memo = new Map<string, Promise<boolean>>();
  const perRequestTimeoutMs = Math.max(500, Math.min(2500, options.timeoutMs));

  return async (tag: string): Promise<boolean> => {
    const normalized = tag.trim();
    if (!normalized) return false;
    const existing = memo.get(normalized);
    if (existing) return existing;

    const request = ghcrTagHasManifest({
      ownerRepo: options.ownerRepo,
      token: options.token,
      tag: normalized,
      timeoutMs: perRequestTimeoutMs,
    });
    memo.set(normalized, request);
    return request;
  };
}

async function pickReadyCandidates<T extends { tag: string }>(options: {
  candidates: T[];
  limit: number | null;
  batchSize?: number;
  isReady: (tag: string) => Promise<boolean>;
}): Promise<T[]> {
  const target = options.limit === null ? Number.POSITIVE_INFINITY : options.limit;
  if (target <= 0) return [];

  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 8));
  const ready: T[] = [];

  let cursor = 0;
  while (cursor < options.candidates.length && ready.length < target) {
    const batch = options.candidates.slice(cursor, cursor + batchSize);
    const statuses = await Promise.all(
      batch.map(async (candidate) => {
        try {
          return await options.isReady(candidate.tag);
        } catch {
          return false;
        }
      }),
    );

    for (let i = 0; i < batch.length; i += 1) {
      if (!statuses[i]) continue;
      ready.push(batch[i]!);
      if (ready.length >= target) break;
    }
    cursor += batch.length;
  }

  return ready;
}

async function pickReadySemverCandidates(options: {
  candidates: SemverCandidate[];
  limit: number | null;
  isReady: (tag: string) => Promise<boolean>;
}): Promise<ReadySemverCandidate[]> {
  const target = options.limit === null ? Number.POSITIVE_INFINITY : options.limit;
  if (target <= 0) return [];

  const ready: ReadySemverCandidate[] = [];
  for (const candidate of options.candidates) {
    let selectedTag: string | null = null;
    for (const tag of candidate.tags) {
      try {
        if (await options.isReady(tag)) {
          selectedTag = tag;
          break;
        }
      } catch {
        // Ignore and try alternate aliases.
      }
    }
    if (!selectedTag) continue;
    ready.push({
      normalized: candidate.normalized,
      version: candidate.version,
      tag: selectedTag,
    });
    if (ready.length >= target) break;
  }

  return ready;
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

  const semverCandidates = buildSemverCandidates(tags);
  if (semverCandidates.length === 0) {
    throw new Error(
      `No semver tags found for GHCR repository ${ownerRepo} (tags=${tags.length})`,
    );
  }

  const isTagReady = createGhcrTagReadinessChecker({
    ownerRepo,
    token,
    timeoutMs: options.timeoutMs,
  });

  const [latestReadySemver] = await pickReadySemverCandidates({
    candidates: semverCandidates,
    limit: 1,
    isReady: isTagReady,
  });

  if (!latestReadySemver) {
    throw new Error(
      `No ready semver tags found for GHCR repository ${ownerRepo} (semverTags=${semverCandidates.length})`,
    );
  }

  return `${imageBase}:${latestReadySemver.tag}`;
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

  const semverCandidates = buildSemverCandidates(tags);
  const devCandidates = buildDevCandidates(tags);

  const semverLimit = normalizeLimit(options.semverLimit, null);
  const devLimit = normalizeLimit(options.devLimit, 50);

  const isTagReady = createGhcrTagReadinessChecker({
    ownerRepo,
    token,
    timeoutMs: options.timeoutMs,
  });

  const readySemverCandidates = await pickReadySemverCandidates({
    candidates: semverCandidates,
    limit: semverLimit,
    isReady: isTagReady,
  });
  const readyDevCandidates = await pickReadyCandidates({
    candidates: devCandidates,
    limit: devLimit,
    isReady: isTagReady,
  });

  const semverImages: GhcrStudioImage[] = readySemverCandidates.map((candidate) => ({
    tag: candidate.tag,
    kind: "semver",
    version: candidate.normalized,
    image: `${imageBase}:${candidate.tag}`,
  }));

  const devImages: GhcrStudioImage[] = readyDevCandidates.map((candidate) => ({
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
