import crypto from "node:crypto";

export const DEFAULT_STUDIO_USER_ACTION_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

type StudioUserActionTokenPayload = {
  v: 1;
  sessionId: string;
  userId: string;
  organizationId: string;
  projectSlug: string;
  version: number;
  nonce: string;
  iat: number;
  exp: number;
};

export type VerifiedStudioUserActionToken = {
  sessionId: string;
  userId: string;
  organizationId: string;
  projectSlug: string;
  version: number;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

type CreateStudioUserActionTokenOptions = {
  sessionId: string;
  userId: string;
  organizationId: string;
  projectSlug: string;
  version: number;
  ttlMs?: number;
  nowMs?: number;
  nonce?: string;
  sessionExpiresAt?: Date | string | number | null;
};

type VerifyStudioUserActionTokenOptions = {
  nowMs?: number;
};

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeSignatureEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function getStudioUserActionTokenSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw =
    env.VIVD_STUDIO_USER_ACTION_TOKEN_SECRET?.trim() ||
    env.BETTER_AUTH_SECRET?.trim() ||
    "";
  return raw || null;
}

function signPayload(payloadSegment: string, secret: string): string {
  return toBase64Url(
    crypto.createHmac("sha256", secret).update(payloadSegment).digest(),
  );
}

function resolveExpiryMs(options: CreateStudioUserActionTokenOptions): number {
  const issuedAtMs = options.nowMs ?? Date.now();
  const requestedExpiryMs =
    issuedAtMs +
    Math.max(60_000, options.ttlMs ?? DEFAULT_STUDIO_USER_ACTION_TOKEN_TTL_MS);

  const sessionExpiryMs = (() => {
    if (!options.sessionExpiresAt) return null;
    const parsed = new Date(options.sessionExpiresAt).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  })();

  if (sessionExpiryMs == null) return requestedExpiryMs;
  return Math.max(issuedAtMs + 1_000, Math.min(requestedExpiryMs, sessionExpiryMs));
}

export function createStudioUserActionToken(
  options: CreateStudioUserActionTokenOptions,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = getStudioUserActionTokenSecret(env);
  if (!secret) {
    throw new Error(
      "createStudioUserActionToken requires VIVD_STUDIO_USER_ACTION_TOKEN_SECRET or BETTER_AUTH_SECRET",
    );
  }

  const sessionId = options.sessionId.trim();
  const userId = options.userId.trim();
  const organizationId = options.organizationId.trim();
  const projectSlug = options.projectSlug.trim();
  const version = options.version;

  if (!sessionId) throw new Error("createStudioUserActionToken requires sessionId");
  if (!userId) throw new Error("createStudioUserActionToken requires userId");
  if (!organizationId) throw new Error("createStudioUserActionToken requires organizationId");
  if (!projectSlug) throw new Error("createStudioUserActionToken requires projectSlug");
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error("createStudioUserActionToken requires a positive integer version");
  }

  const issuedAtMs = options.nowMs ?? Date.now();
  const payload: StudioUserActionTokenPayload = {
    v: 1,
    sessionId,
    userId,
    organizationId,
    projectSlug,
    version,
    nonce: (options.nonce || crypto.randomUUID()).trim(),
    iat: issuedAtMs,
    exp: resolveExpiryMs(options),
  };

  const payloadSegment = toBase64Url(JSON.stringify(payload));
  const signatureSegment = signPayload(payloadSegment, secret);
  return `v1.${payloadSegment}.${signatureSegment}`;
}

export function verifyStudioUserActionToken(
  token: string,
  options: VerifyStudioUserActionTokenOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): VerifiedStudioUserActionToken | null {
  if (!isNonEmptyString(token)) return null;

  const secret = getStudioUserActionTokenSecret(env);
  if (!secret) return null;

  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;

  const payloadSegment = parts[1];
  const signatureSegment = parts[2];
  if (!isNonEmptyString(payloadSegment) || !isNonEmptyString(signatureSegment)) {
    return null;
  }

  const expectedSignature = signPayload(payloadSegment, secret);
  if (!safeSignatureEquals(signatureSegment, expectedSignature)) {
    return null;
  }

  let payload: StudioUserActionTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadSegment).toString("utf8"));
  } catch {
    return null;
  }

  if (
    payload?.v !== 1 ||
    !isNonEmptyString(payload.sessionId) ||
    !isNonEmptyString(payload.userId) ||
    !isNonEmptyString(payload.organizationId) ||
    !isNonEmptyString(payload.projectSlug) ||
    !isNonEmptyString(payload.nonce) ||
    !Number.isInteger(payload.version) ||
    payload.version <= 0 ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp)
  ) {
    return null;
  }

  const nowMs = options.nowMs ?? Date.now();
  if (payload.exp <= nowMs || payload.iat > payload.exp) return null;

  return {
    sessionId: payload.sessionId,
    userId: payload.userId,
    organizationId: payload.organizationId,
    projectSlug: payload.projectSlug,
    version: payload.version,
    nonce: payload.nonce,
    issuedAtMs: payload.iat,
    expiresAtMs: payload.exp,
  };
}
