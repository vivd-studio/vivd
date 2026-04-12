import maxmind, { type CountryResponse, type Reader } from "maxmind";

export type AnalyticsGeolocationMode = "off" | "headers" | "maxmind" | "auto";

export type AnalyticsGeolocationRuntimeConfig = {
  mode: AnalyticsGeolocationMode;
  maxMindDbPath: string;
};

export type AnalyticsGeoRequest = {
  get(name: string): string | undefined;
  ip?: string | undefined;
};

type GeoIpReader = Pick<Reader<CountryResponse>, "get">;
type OpenGeoIpReader = (dbPath: string) => Promise<GeoIpReader>;
type LoggerLike = Pick<Console, "warn">;

const DEFAULT_ANALYTICS_GEOIP_DB_PATH = "/app/geoip/GeoLite2-Country.mmdb";
const GEOIP_RETRY_DELAY_MS = 5 * 60 * 1000;

const COUNTRY_HEADER_CANDIDATES = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "cloudfront-viewer-country",
  "fastly-country-code",
  "x-country-code",
] as const;

const DIRECT_IP_HEADER_CANDIDATES = [
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip",
] as const;

function parseAnalyticsGeolocationMode(raw: string | undefined): AnalyticsGeolocationMode {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase();

  switch (normalized) {
    case "off":
      return "off";
    case "header":
    case "headers":
      return "headers";
    case "geoip":
    case "maxmind":
      return "maxmind";
    case "auto":
    default:
      return "auto";
  }
}

export function readAnalyticsGeolocationRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsGeolocationRuntimeConfig {
  const configuredPath = String(
    env.VIVD_ANALYTICS_GEOIP_DB_PATH || DEFAULT_ANALYTICS_GEOIP_DB_PATH,
  ).trim();

  return {
    mode: parseAnalyticsGeolocationMode(env.VIVD_ANALYTICS_GEOLOCATION_MODE),
    maxMindDbPath: configuredPath || DEFAULT_ANALYTICS_GEOIP_DB_PATH,
  };
}

export function normalizeCountryCode(raw: string | null | undefined): string | null {
  const normalized = String(raw || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return null;
  return normalized;
}

export function detectCountryCodeFromHeaders(req: AnalyticsGeoRequest): string | null {
  for (const headerName of COUNTRY_HEADER_CANDIDATES) {
    const countryCode = normalizeCountryCode(req.get(headerName));
    if (countryCode) return countryCode;
  }
  return null;
}

function normalizeIpLiteral(raw: string | null | undefined): string | null {
  let candidate = String(raw || "").trim();
  if (!candidate) return null;

  if (candidate.toLowerCase() === "unknown" || candidate.startsWith("_")) {
    return null;
  }

  candidate = candidate.replace(/^"|"$/g, "");

  if (candidate.startsWith("[")) {
    const closingBracket = candidate.indexOf("]");
    if (closingBracket > 0) {
      candidate = candidate.slice(1, closingBracket);
    }
  }

  const lowerCandidate = candidate.toLowerCase();
  if (lowerCandidate.startsWith("::ffff:")) {
    const mappedIpv4 = candidate.slice(7);
    if (maxmind.validate(mappedIpv4)) return mappedIpv4;
  }

  if (maxmind.validate(candidate)) return candidate;

  if (
    candidate.includes(".") &&
    candidate.includes(":") &&
    candidate.indexOf(":") === candidate.lastIndexOf(":")
  ) {
    const withoutPort = candidate.slice(0, candidate.lastIndexOf(":"));
    if (maxmind.validate(withoutPort)) return withoutPort;
  }

  return null;
}

function parseXForwardedForHeader(raw: string | null | undefined): string | null {
  for (const part of String(raw || "").split(",")) {
    const ip = normalizeIpLiteral(part);
    if (ip) return ip;
  }
  return null;
}

function parseForwardedHeader(raw: string | null | undefined): string | null {
  for (const proxyEntry of String(raw || "").split(",")) {
    for (const directive of proxyEntry.split(";")) {
      const trimmed = directive.trim();
      if (!trimmed.toLowerCase().startsWith("for=")) continue;
      const ip = normalizeIpLiteral(trimmed.slice(4));
      if (ip) return ip;
    }
  }
  return null;
}

export function extractClientIpFromRequest(req: AnalyticsGeoRequest): string | null {
  for (const headerName of DIRECT_IP_HEADER_CANDIDATES) {
    const ip = normalizeIpLiteral(req.get(headerName));
    if (ip) return ip;
  }

  const forwardedFor = parseXForwardedForHeader(req.get("x-forwarded-for"));
  if (forwardedFor) return forwardedFor;

  const forwarded = parseForwardedHeader(req.get("forwarded"));
  if (forwarded) return forwarded;

  const requestIp = normalizeIpLiteral(req.ip);
  if (requestIp) return requestIp;

  return null;
}

function defaultOpenGeoIpReader(dbPath: string): Promise<GeoIpReader> {
  return maxmind.open<CountryResponse>(dbPath, {
    cache: { max: 10_000 },
    watchForUpdates: true,
    watchForUpdatesNonPersistent: true,
  });
}

export function createAnalyticsCountryResolver(options?: {
  config?: AnalyticsGeolocationRuntimeConfig;
  openReader?: OpenGeoIpReader;
  logger?: LoggerLike;
}) {
  const config = options?.config || readAnalyticsGeolocationRuntimeConfig();
  const openReader = options?.openReader || defaultOpenGeoIpReader;
  const logger = options?.logger || console;

  let readerPromise: Promise<GeoIpReader | null> | null = null;
  let lastReaderFailureAt = 0;
  let lastReaderErrorMessage = "";

  const getReader = async (): Promise<GeoIpReader | null> => {
    if (config.mode === "off" || config.mode === "headers") return null;
    if (readerPromise) return readerPromise;

    if (
      lastReaderFailureAt > 0 &&
      Date.now() - lastReaderFailureAt < GEOIP_RETRY_DELAY_MS
    ) {
      return null;
    }

    readerPromise = openReader(config.maxMindDbPath).catch((error) => {
      readerPromise = null;
      lastReaderFailureAt = Date.now();

      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastReaderErrorMessage) {
        logger.warn(
          `[Analytics] Failed to open GeoIP database at ${config.maxMindDbPath}: ${message}`,
        );
        lastReaderErrorMessage = message;
      }

      return null;
    });

    return readerPromise;
  };

  const resolveFromGeoIp = async (req: AnalyticsGeoRequest): Promise<string | null> => {
    const clientIp = extractClientIpFromRequest(req);
    if (!clientIp) return null;

    const reader = await getReader();
    if (!reader) return null;

    try {
      const response = reader.get(clientIp);
      return normalizeCountryCode(response?.country?.iso_code);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[Analytics] GeoIP lookup failed for ${clientIp}: ${message}`);
      return null;
    }
  };

  return {
    config,
    async resolveCountryCode(
      req: AnalyticsGeoRequest,
      explicitCountryCode?: string | null,
    ): Promise<string | null> {
      const explicit = normalizeCountryCode(explicitCountryCode);
      if (explicit) return explicit;

      if (config.mode === "off") return null;

      const headerCountryCode = detectCountryCodeFromHeaders(req);
      if (config.mode === "headers") return headerCountryCode;
      if (config.mode === "auto" && headerCountryCode) return headerCountryCode;

      const geoIpCountryCode = await resolveFromGeoIp(req);
      if (geoIpCountryCode) return geoIpCountryCode;

      return config.mode === "auto" ? headerCountryCode : null;
    },
  };
}
