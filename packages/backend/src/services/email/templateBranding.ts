import { z } from "zod";
import {
  getSystemSettingJsonValue,
  setSystemSettingJsonValue,
  SYSTEM_SETTING_KEYS,
} from "../system/SystemSettingsService";

const MAX_SHORT_TEXT = 160;
const MAX_LONG_TEXT = 500;
const MAX_URL_LENGTH = 2_048;
const MAX_EMAIL_LENGTH = 320;
const OFFICIAL_HOSTED_SUPPORT_EMAIL = "hello@vivd.studio";
const OFFICIAL_HOSTED_DOMAIN = "vivd.studio";

const emailTemplateBrandingStoredSchema = z
  .object({
    displayName: z.string().trim().min(1).max(MAX_SHORT_TEXT).optional(),
    logoUrl: z.string().trim().url().max(MAX_URL_LENGTH).optional(),
    supportEmail: z.string().trim().email().max(MAX_EMAIL_LENGTH).optional(),
    websiteUrl: z.string().trim().url().max(MAX_URL_LENGTH).optional(),
    legalName: z.string().trim().min(1).max(MAX_SHORT_TEXT).optional(),
    legalAddress: z.string().trim().min(1).max(MAX_LONG_TEXT).optional(),
    imprintUrl: z.string().trim().url().max(MAX_URL_LENGTH).optional(),
    privacyUrl: z.string().trim().url().max(MAX_URL_LENGTH).optional(),
    termsUrl: z.string().trim().url().max(MAX_URL_LENGTH).optional(),
  })
  .strict();

export type EmailTemplateBranding = z.infer<typeof emailTemplateBrandingStoredSchema>;

export const emailTemplateBrandingPatchInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(MAX_SHORT_TEXT).nullable().optional(),
    logoUrl: z.string().trim().url().max(MAX_URL_LENGTH).nullable().optional(),
    supportEmail: z.string().trim().email().max(MAX_EMAIL_LENGTH).nullable().optional(),
    websiteUrl: z.string().trim().url().max(MAX_URL_LENGTH).nullable().optional(),
    legalName: z.string().trim().min(1).max(MAX_SHORT_TEXT).nullable().optional(),
    legalAddress: z.string().trim().min(1).max(MAX_LONG_TEXT).nullable().optional(),
    imprintUrl: z.string().trim().url().max(MAX_URL_LENGTH).nullable().optional(),
    privacyUrl: z.string().trim().url().max(MAX_URL_LENGTH).nullable().optional(),
    termsUrl: z.string().trim().url().max(MAX_URL_LENGTH).nullable().optional(),
  })
  .strict();

export type EmailTemplateBrandingPatchInput = z.infer<
  typeof emailTemplateBrandingPatchInputSchema
>;

type EmailTemplateBrandingKey = keyof EmailTemplateBranding;

const BRANDING_KEYS: EmailTemplateBrandingKey[] = [
  "displayName",
  "logoUrl",
  "supportEmail",
  "websiteUrl",
  "legalName",
  "legalAddress",
  "imprintUrl",
  "privacyUrl",
  "termsUrl",
];

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalEmail(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  const parsed = z.string().email().max(MAX_EMAIL_LENGTH).safeParse(normalized);
  return parsed.success ? parsed.data : undefined;
}

function normalizeOptionalUrl(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  const parsed = z.string().url().max(MAX_URL_LENGTH).safeParse(normalized);
  return parsed.success ? parsed.data : undefined;
}

function normalizeOptionalHost(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const hostname = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed).hostname
      : new URL(`https://${trimmed}`).hostname;
    return hostname.trim().toLowerCase() || undefined;
  } catch {
    const hostname = trimmed
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      ?.split(":")[0]
      ?.trim()
      .toLowerCase();
    return hostname || undefined;
  }
}

function isOfficialHostedControlPlaneHost(hostname: string | undefined): boolean {
  if (!hostname) return false;
  return hostname === OFFICIAL_HOSTED_DOMAIN || hostname.endsWith(`.${OFFICIAL_HOSTED_DOMAIN}`);
}

function resolveHostedDefaultSupportEmail(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const hostCandidates = [
    env.VIVD_APP_URL,
    env.BETTER_AUTH_URL,
    env.CONTROL_PLANE_HOST,
    env.BACKEND_URL,
    env.DOMAIN,
  ];

  const officialHosted = hostCandidates.some((candidate) =>
    isOfficialHostedControlPlaneHost(normalizeOptionalHost(candidate)),
  );
  if (!officialHosted) return undefined;

  return OFFICIAL_HOSTED_SUPPORT_EMAIL;
}

function normalizeEmailTemplateBranding(
  value: Partial<Record<EmailTemplateBrandingKey, unknown>> | null | undefined,
): EmailTemplateBranding {
  const normalized: Partial<EmailTemplateBranding> = {
    displayName: normalizeOptionalString(value?.displayName),
    logoUrl: normalizeOptionalUrl(value?.logoUrl),
    supportEmail: normalizeOptionalEmail(value?.supportEmail),
    websiteUrl: normalizeOptionalUrl(value?.websiteUrl),
    legalName: normalizeOptionalString(value?.legalName),
    legalAddress: normalizeOptionalString(value?.legalAddress),
    imprintUrl: normalizeOptionalUrl(value?.imprintUrl),
    privacyUrl: normalizeOptionalUrl(value?.privacyUrl),
    termsUrl: normalizeOptionalUrl(value?.termsUrl),
  };

  return Object.fromEntries(
    Object.entries(normalized).filter(([, fieldValue]) => fieldValue != null),
  ) as EmailTemplateBranding;
}

function readEnvBootstrap(): EmailTemplateBranding {
  return normalizeEmailTemplateBranding({
    displayName: process.env.VIVD_EMAIL_BRAND_DISPLAY_NAME,
    logoUrl: process.env.VIVD_EMAIL_BRAND_LOGO_URL,
    supportEmail: process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL,
    websiteUrl: process.env.VIVD_EMAIL_BRAND_WEBSITE_URL,
    legalName: process.env.VIVD_EMAIL_BRAND_LEGAL_NAME,
    legalAddress: process.env.VIVD_EMAIL_BRAND_LEGAL_ADDRESS,
    imprintUrl: process.env.VIVD_EMAIL_BRAND_IMPRINT_URL,
    privacyUrl: process.env.VIVD_EMAIL_BRAND_PRIVACY_URL,
    termsUrl: process.env.VIVD_EMAIL_BRAND_TERMS_URL,
  });
}

async function readStoredBranding(): Promise<EmailTemplateBranding> {
  const stored = await getSystemSettingJsonValue<unknown>(
    SYSTEM_SETTING_KEYS.emailTemplateBranding,
  );

  const parsed = emailTemplateBrandingStoredSchema.partial().safeParse(stored);
  if (!parsed.success) {
    return normalizeEmailTemplateBranding(stored as Record<string, unknown> | null);
  }

  return normalizeEmailTemplateBranding(parsed.data);
}

export class EmailTemplateBrandingService {
  async getResolvedBranding(): Promise<EmailTemplateBranding> {
    const [stored, envBootstrap] = await Promise.all([
      readStoredBranding(),
      Promise.resolve(readEnvBootstrap()),
    ]);

    const resolved = normalizeEmailTemplateBranding({
      ...envBootstrap,
      ...stored,
    });
    if (resolved.supportEmail) {
      return resolved;
    }

    const hostedDefaultSupportEmail = resolveHostedDefaultSupportEmail(process.env);
    if (!hostedDefaultSupportEmail) {
      return resolved;
    }

    return normalizeEmailTemplateBranding({
      ...resolved,
      supportEmail: hostedDefaultSupportEmail,
    });
  }

  async updateBranding(
    patch: EmailTemplateBrandingPatchInput,
  ): Promise<EmailTemplateBranding> {
    const currentStored = await readStoredBranding();
    const nextStored: Partial<EmailTemplateBranding> = {
      ...currentStored,
    };

    for (const key of BRANDING_KEYS) {
      if (!(key in patch)) continue;
      const nextValue = patch[key];
      if (nextValue == null) {
        delete nextStored[key];
      } else {
        nextStored[key] = nextValue;
      }
    }

    const normalizedStored = normalizeEmailTemplateBranding(nextStored);
    await setSystemSettingJsonValue(
      SYSTEM_SETTING_KEYS.emailTemplateBranding,
      Object.keys(normalizedStored).length > 0 ? normalizedStored : null,
    );

    return this.getResolvedBranding();
  }
}

export const emailTemplateBrandingService = new EmailTemplateBrandingService();
