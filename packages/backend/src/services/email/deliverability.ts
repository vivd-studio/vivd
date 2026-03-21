import { z } from "zod";
import {
  getSystemSettingValue,
  setSystemSettingValue,
} from "../system/SystemSettingsService";

const EMAIL_DELIVERABILITY_STATE_KEY = "email_deliverability_state_v1";
const EMAIL_DELIVERABILITY_POLICY_KEY = "email_deliverability_policy_v1";
const MAX_RECENT_EVENTS = 120;

const feedbackEventTypeSchema = z.enum(["bounce", "complaint"]);
const feedbackSourceSchema = z.enum(["provider_webhook", "manual"]);

const deliverabilityPolicySchema = z.object({
  autoSuppressBounces: z.boolean().default(true),
  autoSuppressComplaints: z.boolean().default(true),
  complaintRateThresholdPercent: z.number().min(0).max(100).default(0.1),
  bounceRateThresholdPercent: z.number().min(0).max(100).default(5),
});

const suppressedRecipientSchema = z.object({
  email: z.string().email(),
  reason: feedbackEventTypeSchema,
  source: feedbackSourceSchema,
  provider: z.string().trim().min(1).max(80),
  firstRecordedAt: z.string().datetime(),
  lastRecordedAt: z.string().datetime(),
  eventCount: z.number().int().min(1).default(1),
  lastOrganizationId: z.string().trim().min(1).max(120).nullable().default(null),
  lastProjectSlug: z.string().trim().min(1).max(120).nullable().default(null),
  lastFlow: z.string().trim().min(1).max(80).nullable().default(null),
});

const recentEventSchema = z.object({
  email: z.string().email(),
  type: feedbackEventTypeSchema,
  source: feedbackSourceSchema,
  provider: z.string().trim().min(1).max(80),
  flow: z.string().trim().min(1).max(80).nullable().default(null),
  organizationId: z.string().trim().min(1).max(120).nullable().default(null),
  projectSlug: z.string().trim().min(1).max(120).nullable().default(null),
  occurredAt: z.string().datetime(),
});

const deliverabilityTotalsSchema = z.object({
  bounceEvents: z.number().int().min(0).default(0),
  complaintEvents: z.number().int().min(0).default(0),
  lastEventAt: z.string().datetime().nullable().default(null),
});

const deliverabilityStateSchema = z.object({
  totals: deliverabilityTotalsSchema.optional(),
  suppressedRecipients: z.array(suppressedRecipientSchema).default([]),
  recentEvents: z.array(recentEventSchema).default([]),
  updatedAt: z.string().datetime().nullable().default(null),
});

type DeliverabilityPolicy = z.infer<typeof deliverabilityPolicySchema>;

type DeliverabilityState = {
  totals: z.infer<typeof deliverabilityTotalsSchema>;
  suppressedRecipients: z.infer<typeof suppressedRecipientSchema>[];
  recentEvents: z.infer<typeof recentEventSchema>[];
  updatedAt: string | null;
};

export type EmailFeedbackEventType = z.infer<typeof feedbackEventTypeSchema>;
export type EmailFeedbackSource = z.infer<typeof feedbackSourceSchema>;

export interface EmailDeliverabilitySummary {
  policy: DeliverabilityPolicy;
  metrics: {
    suppressedRecipientCount: number;
    bounceEventCount: number;
    complaintEventCount: number;
    lastEventAt: string | null;
    updatedAt: string | null;
  };
  suppressedRecipients: z.infer<typeof suppressedRecipientSchema>[];
  recentEvents: z.infer<typeof recentEventSchema>[];
}

export interface EmailDeliverabilityOverview extends EmailDeliverabilitySummary {
  provider: {
    name: string;
    webhookSecretConfigured: boolean;
    autoConfirmSubscriptionsEnabled: boolean;
  };
}

export interface EmailFeedbackRecordInput {
  type: EmailFeedbackEventType;
  recipientEmails: string[];
  provider: string;
  source?: EmailFeedbackSource;
  occurredAt?: string;
  organizationId?: string | null;
  projectSlug?: string | null;
  flow?: string | null;
}

export interface EmailSuppressionFilterResult {
  deliverableRecipients: string[];
  suppressedRecipients: z.infer<typeof suppressedRecipientSchema>[];
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readPercentageEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fallback;
  return parsed;
}

function hasSesConfigurationHints(): boolean {
  return Boolean(
    (process.env.VIVD_SES_FROM_EMAIL || "").trim() ||
      ((process.env.VIVD_SES_ACCESS_KEY_ID || "").trim() &&
        (process.env.VIVD_SES_SECRET_ACCESS_KEY || "").trim()),
  );
}

function hasResendConfigurationHints(): boolean {
  return Boolean((process.env.RESEND_API_KEY || "").trim());
}

function hasSmtpConfigurationHints(): boolean {
  return Boolean(
    (process.env.VIVD_SMTP_URL || "").trim() ||
      (process.env.VIVD_SMTP_HOST || "").trim(),
  );
}

export function resolveConfiguredEmailProviderName(): string {
  const explicit =
    (process.env.VIVD_EMAIL_PROVIDER || process.env.EMAIL_PROVIDER || "")
      .trim()
      .toLowerCase();
  if (explicit) return explicit;
  if (hasResendConfigurationHints()) return "resend";
  if (hasSesConfigurationHints()) return "ses";
  if (hasSmtpConfigurationHints()) return "smtp";
  return "noop";
}

export function isSesFeedbackAutoConfirmEnabled(): boolean {
  return readBooleanEnv("VIVD_SES_FEEDBACK_AUTO_CONFIRM", false);
}

export function isSesFeedbackWebhookSecretConfigured(): boolean {
  return (process.env.VIVD_SES_FEEDBACK_WEBHOOK_SECRET || "").trim().length > 0;
}

export function isResendFeedbackWebhookSecretConfigured(): boolean {
  return (process.env.RESEND_WEBHOOK_SECRET || "").trim().length > 0;
}

function isWebhookSecretConfiguredForProvider(providerName: string): boolean {
  if (providerName === "resend") {
    return isResendFeedbackWebhookSecretConfigured();
  }
  if (providerName === "smtp") {
    return false;
  }
  return isSesFeedbackWebhookSecretConfigured();
}

function resolveDefaultPolicy(): DeliverabilityPolicy {
  return {
    autoSuppressBounces: readBooleanEnv(
      "VIVD_CONTACT_FORM_AUTO_SUPPRESS_BOUNCES",
      true,
    ),
    autoSuppressComplaints: readBooleanEnv(
      "VIVD_CONTACT_FORM_AUTO_SUPPRESS_COMPLAINTS",
      true,
    ),
    complaintRateThresholdPercent: readPercentageEnv(
      "VIVD_CONTACT_FORM_COMPLAINT_RATE_THRESHOLD_PERCENT",
      0.1,
    ),
    bounceRateThresholdPercent: readPercentageEnv(
      "VIVD_CONTACT_FORM_BOUNCE_RATE_THRESHOLD_PERCENT",
      5,
    ),
  };
}

function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeUniqueEmailAddresses(emails: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const rawEmail of emails) {
    const normalized = normalizeEmailAddress(rawEmail);
    if (!normalized || seen.has(normalized)) continue;
    if (!z.string().email().safeParse(normalized).success) continue;
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeProviderName(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "unknown";
  return trimmed.slice(0, 80);
}

function compareIsoDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function parsePolicy(raw: string | null): DeliverabilityPolicy {
  const fallback = resolveDefaultPolicy();
  if (!raw) return fallback;

  try {
    const parsed = deliverabilityPolicySchema.partial().safeParse(JSON.parse(raw));
    if (!parsed.success) return fallback;

    return {
      ...fallback,
      ...parsed.data,
    };
  } catch {
    return fallback;
  }
}

function parseState(raw: string | null): DeliverabilityState {
  const fallback: DeliverabilityState = {
    totals: {
      bounceEvents: 0,
      complaintEvents: 0,
      lastEventAt: null,
    },
    suppressedRecipients: [],
    recentEvents: [],
    updatedAt: null,
  };

  if (!raw) return fallback;

  try {
    const parsed = deliverabilityStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return fallback;

    return {
      ...fallback,
      ...parsed.data,
      totals: {
        ...fallback.totals,
        ...(parsed.data.totals ?? {}),
      },
      suppressedRecipients: parsed.data.suppressedRecipients ?? [],
      recentEvents: parsed.data.recentEvents ?? [],
    };
  } catch {
    return fallback;
  }
}

function toSummary(
  state: DeliverabilityState,
  policy: DeliverabilityPolicy,
): EmailDeliverabilitySummary {
  const sortedSuppressedRecipients = [...state.suppressedRecipients].sort((left, right) => {
    const byLast = compareIsoDesc(left.lastRecordedAt, right.lastRecordedAt);
    if (byLast !== 0) return byLast;
    return left.email.localeCompare(right.email);
  });

  const sortedRecentEvents = [...state.recentEvents].sort((left, right) => {
    const byOccurred = compareIsoDesc(left.occurredAt, right.occurredAt);
    if (byOccurred !== 0) return byOccurred;
    return left.email.localeCompare(right.email);
  });

  return {
    policy,
    metrics: {
      suppressedRecipientCount: sortedSuppressedRecipients.length,
      bounceEventCount: state.totals.bounceEvents,
      complaintEventCount: state.totals.complaintEvents,
      lastEventAt: state.totals.lastEventAt,
      updatedAt: state.updatedAt,
    },
    suppressedRecipients: sortedSuppressedRecipients,
    recentEvents: sortedRecentEvents,
  };
}

class EmailDeliverabilityService {
  private async readPolicy(): Promise<DeliverabilityPolicy> {
    const raw = await getSystemSettingValue(EMAIL_DELIVERABILITY_POLICY_KEY);
    return parsePolicy(raw);
  }

  private async writePolicy(policy: DeliverabilityPolicy): Promise<void> {
    await setSystemSettingValue(EMAIL_DELIVERABILITY_POLICY_KEY, JSON.stringify(policy));
  }

  private async readState(): Promise<DeliverabilityState> {
    const raw = await getSystemSettingValue(EMAIL_DELIVERABILITY_STATE_KEY);
    return parseState(raw);
  }

  private async writeState(state: DeliverabilityState): Promise<void> {
    await setSystemSettingValue(EMAIL_DELIVERABILITY_STATE_KEY, JSON.stringify(state));
  }

  async getOverview(): Promise<EmailDeliverabilityOverview> {
    const [state, policy] = await Promise.all([this.readState(), this.readPolicy()]);
    const providerName = resolveConfiguredEmailProviderName();

    return {
      ...toSummary(state, policy),
      provider: {
        name: providerName,
        webhookSecretConfigured: isWebhookSecretConfiguredForProvider(providerName),
        autoConfirmSubscriptionsEnabled: isSesFeedbackAutoConfirmEnabled(),
      },
    };
  }

  async updatePolicy(input: {
    autoSuppressBounces: boolean;
    autoSuppressComplaints: boolean;
    complaintRateThresholdPercent: number;
    bounceRateThresholdPercent: number;
  }): Promise<EmailDeliverabilityOverview> {
    const parsed = deliverabilityPolicySchema.parse(input);
    await this.writePolicy(parsed);
    return this.getOverview();
  }

  async filterSuppressedRecipients(options: {
    recipientEmails: string[];
  }): Promise<EmailSuppressionFilterResult> {
    const normalizedRecipients = normalizeUniqueEmailAddresses(options.recipientEmails);
    if (normalizedRecipients.length === 0) {
      return {
        deliverableRecipients: [],
        suppressedRecipients: [],
      };
    }

    const state = await this.readState();
    const suppressedByEmail = new Map(
      state.suppressedRecipients.map((entry) => [
        normalizeEmailAddress(entry.email),
        entry,
      ]),
    );

    const deliverableRecipients: string[] = [];
    const suppressedRecipients: z.infer<typeof suppressedRecipientSchema>[] = [];

    for (const email of normalizedRecipients) {
      const suppression = suppressedByEmail.get(email);
      if (suppression) {
        suppressedRecipients.push(suppression);
      } else {
        deliverableRecipients.push(email);
      }
    }

    return {
      deliverableRecipients,
      suppressedRecipients,
    };
  }

  async recordFeedback(input: EmailFeedbackRecordInput): Promise<{
    summary: EmailDeliverabilityOverview;
    appliedRecipientCount: number;
  }> {
    const normalizedRecipients = normalizeUniqueEmailAddresses(input.recipientEmails);
    const [state, policy] = await Promise.all([this.readState(), this.readPolicy()]);
    const occurredAt =
      input.occurredAt && z.string().datetime().safeParse(input.occurredAt).success
        ? input.occurredAt
        : new Date().toISOString();
    const source = input.source || "provider_webhook";
    const provider = normalizeProviderName(input.provider);
    const organizationId = normalizeOptionalText(input.organizationId, 120);
    const projectSlug = normalizeOptionalText(input.projectSlug, 120);
    const flow = normalizeOptionalText(input.flow, 80);

    if (normalizedRecipients.length > 0) {
      if (input.type === "bounce") {
        state.totals.bounceEvents += normalizedRecipients.length;
      } else {
        state.totals.complaintEvents += normalizedRecipients.length;
      }
      state.totals.lastEventAt = occurredAt;

      for (const email of normalizedRecipients) {
        state.recentEvents.unshift({
          email,
          type: input.type,
          source,
          provider,
          flow,
          organizationId,
          projectSlug,
          occurredAt,
        });
      }

      if (state.recentEvents.length > MAX_RECENT_EVENTS) {
        state.recentEvents = state.recentEvents.slice(0, MAX_RECENT_EVENTS);
      }

      const autoSuppress =
        input.type === "bounce"
          ? policy.autoSuppressBounces
          : policy.autoSuppressComplaints;

      if (autoSuppress) {
        const suppressedByEmail = new Map(
          state.suppressedRecipients.map((entry) => [entry.email, entry]),
        );

        for (const email of normalizedRecipients) {
          const existing = suppressedByEmail.get(email);
          if (existing) {
            existing.lastRecordedAt = occurredAt;
            existing.eventCount += 1;
            if (input.type === "complaint") {
              existing.reason = "complaint";
            }
            existing.source = source;
            existing.provider = provider;
            existing.lastOrganizationId = organizationId;
            existing.lastProjectSlug = projectSlug;
            existing.lastFlow = flow;
            continue;
          }

          state.suppressedRecipients.push({
            email,
            reason: input.type,
            source,
            provider,
            firstRecordedAt: occurredAt,
            lastRecordedAt: occurredAt,
            eventCount: 1,
            lastOrganizationId: organizationId,
            lastProjectSlug: projectSlug,
            lastFlow: flow,
          });
        }
      }
    }

    state.updatedAt = new Date().toISOString();
    await this.writeState(state);

    return {
      summary: {
        ...toSummary(state, policy),
        provider: {
          name: resolveConfiguredEmailProviderName(),
          webhookSecretConfigured: isWebhookSecretConfiguredForProvider(
            resolveConfiguredEmailProviderName(),
          ),
          autoConfirmSubscriptionsEnabled: isSesFeedbackAutoConfirmEnabled(),
        },
      },
      appliedRecipientCount: normalizedRecipients.length,
    };
  }

  async unsuppressRecipient(options: {
    email: string;
  }): Promise<EmailDeliverabilityOverview> {
    const normalizedEmail = normalizeEmailAddress(options.email);
    const [state, policy] = await Promise.all([this.readState(), this.readPolicy()]);

    state.suppressedRecipients = state.suppressedRecipients.filter(
      (entry) => normalizeEmailAddress(entry.email) !== normalizedEmail,
    );
    state.updatedAt = new Date().toISOString();

    await this.writeState(state);

    return {
      ...toSummary(state, policy),
      provider: {
        name: resolveConfiguredEmailProviderName(),
        webhookSecretConfigured: isWebhookSecretConfiguredForProvider(
          resolveConfiguredEmailProviderName(),
        ),
        autoConfirmSubscriptionsEnabled: isSesFeedbackAutoConfirmEnabled(),
      },
    };
  }
}

export const emailDeliverabilityService = new EmailDeliverabilityService();
