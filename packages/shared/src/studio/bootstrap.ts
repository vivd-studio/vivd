import crypto from "node:crypto";

export const DEFAULT_STUDIO_BOOTSTRAP_TOKEN_TTL_MS = 60_000;

type StudioBootstrapTokenPayload = {
  v: 1;
  studioId: string;
  nonce: string;
  iat: number;
  exp: number;
};

export type VerifiedStudioBootstrapToken = {
  studioId: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

type CreateStudioBootstrapTokenOptions = {
  accessToken: string;
  studioId: string;
  ttlMs?: number;
  nowMs?: number;
  nonce?: string;
};

type VerifyStudioBootstrapTokenOptions = {
  accessToken: string;
  studioId: string;
  nowMs?: number;
};

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function signStudioBootstrapPayload(
  payloadSegment: string,
  accessToken: string,
): string {
  return toBase64Url(
    crypto.createHmac("sha256", accessToken).update(payloadSegment).digest(),
  );
}

function isValidTokenString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeSignatureEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function createStudioBootstrapToken(
  options: CreateStudioBootstrapTokenOptions,
): string {
  const accessToken = options.accessToken.trim();
  const studioId = options.studioId.trim();
  if (!accessToken) {
    throw new Error("createStudioBootstrapToken requires accessToken");
  }
  if (!studioId) {
    throw new Error("createStudioBootstrapToken requires studioId");
  }

  const issuedAtMs = options.nowMs ?? Date.now();
  const ttlMs = Math.max(1_000, options.ttlMs ?? DEFAULT_STUDIO_BOOTSTRAP_TOKEN_TTL_MS);
  const payload: StudioBootstrapTokenPayload = {
    v: 1,
    studioId,
    nonce: (options.nonce || crypto.randomUUID()).trim(),
    iat: issuedAtMs,
    exp: issuedAtMs + ttlMs,
  };

  const payloadSegment = toBase64Url(JSON.stringify(payload));
  const signatureSegment = signStudioBootstrapPayload(payloadSegment, accessToken);
  return `v1.${payloadSegment}.${signatureSegment}`;
}

export function verifyStudioBootstrapToken(
  token: string,
  options: VerifyStudioBootstrapTokenOptions,
): VerifiedStudioBootstrapToken | null {
  if (!isValidTokenString(token)) return null;

  const accessToken = options.accessToken.trim();
  const studioId = options.studioId.trim();
  if (!accessToken || !studioId) return null;

  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;

  const payloadSegment = parts[1];
  const signatureSegment = parts[2];
  if (!isValidTokenString(payloadSegment) || !isValidTokenString(signatureSegment)) {
    return null;
  }

  const expectedSignature = signStudioBootstrapPayload(payloadSegment, accessToken);
  if (!safeSignatureEquals(signatureSegment, expectedSignature)) {
    return null;
  }

  let payload: StudioBootstrapTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadSegment).toString("utf8"));
  } catch {
    return null;
  }

  if (
    payload?.v !== 1 ||
    !isValidTokenString(payload.studioId) ||
    !isValidTokenString(payload.nonce) ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp)
  ) {
    return null;
  }

  if (payload.studioId !== studioId) return null;

  const nowMs = options.nowMs ?? Date.now();
  if (payload.exp <= nowMs) return null;
  if (payload.iat > payload.exp) return null;

  return {
    studioId: payload.studioId,
    nonce: payload.nonce,
    issuedAtMs: payload.iat,
    expiresAtMs: payload.exp,
  };
}
