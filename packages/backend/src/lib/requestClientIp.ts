type HeaderValue = string | string[] | undefined;

type RequestLike = {
  headers: Record<string, HeaderValue>;
  ip?: string | null;
};

function readSingleHeader(value: HeaderValue): string | null {
  if (typeof value === "string") {
    const normalized = value.split(",")[0]?.trim() ?? "";
    return normalized || null;
  }

  if (Array.isArray(value) && value.length > 0) {
    const normalized = value[0]?.split(",")[0]?.trim() ?? "";
    return normalized || null;
  }

  return null;
}

export function extractRequestIp(req: RequestLike): string | null {
  const cfConnectingIp = readSingleHeader(req.headers["cf-connecting-ip"]);
  if (cfConnectingIp) return cfConnectingIp;

  const xRealIp = readSingleHeader(req.headers["x-real-ip"]);
  if (xRealIp) return xRealIp;

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const parts = forwarded
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] ?? null : null;
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    for (let index = forwarded.length - 1; index >= 0; index -= 1) {
      const candidate = forwarded[index]?.trim();
      if (candidate) return candidate;
    }
  }

  const requestIp = req.ip?.trim();
  return requestIp || null;
}
