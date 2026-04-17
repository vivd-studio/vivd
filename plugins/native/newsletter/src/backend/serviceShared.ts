import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  newsletterPluginConfigSchema,
  type NewsletterPluginConfig,
} from "./config";
import {
  getNewsletterConfirmEndpoint,
  getNewsletterSubscribeEndpoint,
  getNewsletterUnsubscribeEndpoint,
} from "./publicApi";
import type {
  NewsletterPluginInstanceRow,
  NewsletterPluginServiceDeps,
} from "./ports";
import { withRedirectParam } from "./sourceHosts";

export const confirmEmailSchema = z.string().trim().email();
export const campaignSubjectSchema = z.string().trim().min(1).max(160);
export const campaignBodySchema = z.string().trim().min(1).max(20_000);
export const CONFIRM_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;
export const UNSUBSCRIBE_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 5 * 60 * 1000;
export const TOKEN_RATE_LIMIT_PER_MINUTE = 30;
export const IP_RATE_LIMIT_PER_HOUR = 25;

export type NewsletterProjectScope = {
  organizationId: string;
  projectSlug: string;
};

export type NewsletterStatus =
  | "pending"
  | "confirmed"
  | "unsubscribed"
  | "bounced"
  | "complained";

export type NewsletterCampaignStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "canceled";

export type NewsletterCampaignDeliveryStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "skipped"
  | "canceled";

export function normalizeNewsletterConfig(
  configJson: unknown,
): NewsletterPluginConfig {
  const parsed = newsletterPluginConfigSchema.safeParse(configJson ?? {});
  if (parsed.success) return parsed.data;
  return newsletterPluginConfigSchema.parse({});
}

export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeName(value: string | null | undefined): string | null {
  const normalized = (value || "").trim().slice(0, 120);
  return normalized || null;
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashClientIp(value: string | null | undefined): string | null {
  const normalized = (value || "").trim();
  if (!normalized) return null;
  return hashToken(normalized);
}

export function createRawToken(): string {
  return randomBytes(24).toString("hex");
}

export function toIsoString(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

export function toCount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createEmptyDeliveryCounts(): Record<
  NewsletterCampaignDeliveryStatus,
  number
> {
  return {
    queued: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    canceled: 0,
  };
}

export class NewsletterPluginNotEnabledError extends Error {
  constructor() {
    super(
      "Newsletter plugin is not enabled for this project. Ask a super-admin to enable it first.",
    );
    this.name = "NewsletterPluginNotEnabledError";
  }
}

export class NewsletterSubscriberNotFoundError extends Error {
  constructor(email: string) {
    super(`Subscriber not found: ${email}`);
    this.name = "NewsletterSubscriberNotFoundError";
  }
}

export class NewsletterSubscriberSuppressedError extends Error {
  constructor(email: string) {
    super(`Subscriber cannot be reactivated automatically: ${email}`);
    this.name = "NewsletterSubscriberSuppressedError";
  }
}

export class NewsletterCampaignNotFoundError extends Error {
  constructor(campaignId: string) {
    super(`Campaign draft not found: ${campaignId}`);
    this.name = "NewsletterCampaignNotFoundError";
  }
}

export class NewsletterCampaignStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterCampaignStateError";
  }
}

export class NewsletterConfirmationDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterConfirmationDeliveryError";
  }
}

export class NewsletterCampaignDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterCampaignDeliveryError";
  }
}

export class NewsletterSignupRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterSignupRateLimitError";
  }
}

export class NewsletterSignupSourceHostError extends Error {
  constructor() {
    super("Newsletter signup source host is not allowed for this project.");
    this.name = "NewsletterSignupSourceHostError";
  }
}

export async function resolvePublicEndpoints(
  deps: NewsletterPluginServiceDeps,
) {
  const baseUrl = await deps.getPublicPluginApiBaseUrl();
  return {
    subscribeEndpoint: getNewsletterSubscribeEndpoint(baseUrl),
    confirmEndpoint: getNewsletterConfirmEndpoint(baseUrl),
    unsubscribeEndpoint: getNewsletterUnsubscribeEndpoint(baseUrl),
  };
}

export async function readProjectTitle(
  deps: NewsletterPluginServiceDeps,
  options: NewsletterProjectScope,
): Promise<string> {
  const row = await deps.db.query.projectMeta?.findFirst?.({
    where: and(
      eq(deps.tables.projectMeta.organizationId, options.organizationId),
      eq(deps.tables.projectMeta.slug, options.projectSlug),
    ),
    columns: {
      title: true,
    },
  });

  const title = row?.title?.trim?.();
  return title || options.projectSlug;
}

export async function loadEnabledNewsletterPluginInstance(
  deps: NewsletterPluginServiceDeps,
  options: NewsletterProjectScope,
): Promise<NewsletterPluginInstanceRow> {
  const existing = await deps.projectPluginInstanceService.getPluginInstance({
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    pluginId: "newsletter",
  });
  if (!existing || existing.status !== "enabled") {
    throw new NewsletterPluginNotEnabledError();
  }
  return existing;
}

export async function issueUnsubscribeToken(options: {
  deps: NewsletterPluginServiceDeps;
  subscriberId: string;
  organizationId: string;
  projectSlug: string;
}) {
  const {
    deps,
    subscriberId,
    organizationId,
    projectSlug,
  } = options;
  const token = createRawToken();
  const now = new Date();

  await deps.db
    .delete(deps.tables.newsletterActionToken)
    .where(
      and(
        eq(deps.tables.newsletterActionToken.subscriberId, subscriberId),
        eq(deps.tables.newsletterActionToken.kind, "unsubscribe"),
      ),
    );

  await deps.db.insert(deps.tables.newsletterActionToken).values({
    id: randomUUID(),
    subscriberId,
    organizationId,
    projectSlug,
    kind: "unsubscribe",
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + UNSUBSCRIBE_TOKEN_TTL_MS),
    usedAt: null,
  });

  return token;
}

export async function rotateActionTokens(options: {
  deps: NewsletterPluginServiceDeps;
  subscriberId: string;
  organizationId: string;
  projectSlug: string;
}) {
  const {
    deps,
    subscriberId,
    organizationId,
    projectSlug,
  } = options;
  const confirmToken = createRawToken();
  const unsubscribeToken = createRawToken();
  const now = new Date();

  await deps.db
    .delete(deps.tables.newsletterActionToken)
    .where(eq(deps.tables.newsletterActionToken.subscriberId, subscriberId));

  await deps.db.insert(deps.tables.newsletterActionToken).values([
    {
      id: randomUUID(),
      subscriberId,
      organizationId,
      projectSlug,
      kind: "confirm",
      tokenHash: hashToken(confirmToken),
      expiresAt: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS),
      usedAt: null,
    },
    {
      id: randomUUID(),
      subscriberId,
      organizationId,
      projectSlug,
      kind: "unsubscribe",
      tokenHash: hashToken(unsubscribeToken),
      expiresAt: new Date(now.getTime() + UNSUBSCRIBE_TOKEN_TTL_MS),
      usedAt: null,
    },
  ]);

  return {
    confirmToken,
    unsubscribeToken,
  };
}

export async function sendConfirmationEmail(options: {
  deps: NewsletterPluginServiceDeps;
  organizationId: string;
  projectSlug: string;
  subscriberId: string;
  email: string;
  redirectTarget: string | null;
  recipientName?: string | null;
  mode: "newsletter" | "waitlist";
}) {
  const {
    deps,
    organizationId,
    projectSlug,
    subscriberId,
    email,
    redirectTarget,
    recipientName,
    mode,
  } = options;

  const [endpoints, projectTitle, tokens] = await Promise.all([
    resolvePublicEndpoints(deps),
    readProjectTitle(deps, { organizationId, projectSlug }),
    rotateActionTokens({
      deps,
      subscriberId,
      organizationId,
      projectSlug,
    }),
  ]);

  const confirmUrl = withRedirectParam(
    `${endpoints.confirmEndpoint}?token=${encodeURIComponent(tokens.confirmToken)}`,
    redirectTarget,
  );
  const unsubscribeUrl = withRedirectParam(
    `${endpoints.unsubscribeEndpoint}?token=${encodeURIComponent(tokens.unsubscribeToken)}`,
    redirectTarget,
  );
  const emailPayload = await deps.emailTemplates.buildConfirmationEmail({
    projectTitle,
    recipientName,
    confirmUrl,
    unsubscribeUrl,
    expiresInSeconds: Math.floor(CONFIRM_TOKEN_TTL_MS / 1000),
    mode,
  });

  const result = await deps.emailDeliveryService.send({
    to: [email],
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    metadata: {
      category: "newsletter.confirmation",
      plugin: "newsletter",
      organization: organizationId,
      project: projectSlug,
    },
  });

  if (!result.accepted) {
    throw new NewsletterConfirmationDeliveryError(
      result.error || "Failed to send confirmation email.",
    );
  }
}

export async function sendCampaignEmail(options: {
  deps: NewsletterPluginServiceDeps;
  organizationId: string;
  projectSlug: string;
  projectTitle: string;
  campaignId: string;
  subject: string;
  body: string;
  email: string;
  recipientName?: string | null;
  unsubscribeUrl?: string | null;
  mode: "newsletter" | "waitlist";
  isTest?: boolean;
}) {
  const {
    deps,
    organizationId,
    projectSlug,
    projectTitle,
    campaignId,
    subject,
    body,
    email,
    recipientName,
    unsubscribeUrl,
    mode,
    isTest,
  } = options;

  const emailPayload = await deps.emailTemplates.buildCampaignEmail({
    projectTitle,
    recipientName,
    subject,
    body,
    unsubscribeUrl,
    mode,
    isTest,
  });

  const result = await deps.emailDeliveryService.send({
    to: [email],
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    metadata: {
      category: isTest
        ? "newsletter.broadcast.test"
        : "newsletter.broadcast",
      plugin: "newsletter",
      organization: organizationId,
      project: projectSlug,
      campaign: campaignId,
    },
  });

  if (!result.accepted) {
    throw new NewsletterCampaignDeliveryError(
      result.error || "Failed to send campaign email.",
    );
  }

  return result;
}
