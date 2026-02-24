import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import {
  contactFormRecipientVerification,
  organizationMember,
  projectPluginInstance,
} from "../../../db/schema";
import { buildContactRecipientVerificationEmail } from "../../email/templates";
import { getEmailDeliveryService } from "../../integrations/EmailDeliveryService";
import {
  contactFormPluginConfigSchema,
  type ContactFormPluginConfig,
} from "./config";
import { getContactRecipientVerificationEndpoint } from "./publicApi";

const recipientEmailSchema = z.string().email();
const DEFAULT_TOKEN_EXPIRY_SECONDS = 24 * 60 * 60;
const DEFAULT_RESEND_COOLDOWN_SECONDS = 60;
const DEFAULT_MAX_PENDING_PER_PROJECT = 100;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const tokenExpirySeconds = readPositiveIntEnv(
  "VIVD_CONTACT_FORM_RECIPIENT_VERIFY_EXPIRES_IN_SECONDS",
  DEFAULT_TOKEN_EXPIRY_SECONDS,
);
const resendCooldownSeconds = readPositiveIntEnv(
  "VIVD_CONTACT_FORM_RECIPIENT_VERIFY_RESEND_COOLDOWN_SECONDS",
  DEFAULT_RESEND_COOLDOWN_SECONDS,
);
const maxPendingPerProject = readPositiveIntEnv(
  "VIVD_CONTACT_FORM_RECIPIENT_VERIFY_MAX_PENDING",
  DEFAULT_MAX_PENDING_PER_PROJECT,
);

function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeUniqueEmails(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeEmailAddress(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function generateVerificationToken(): string {
  return `${randomUUID()}.${randomBytes(24).toString("base64url")}`;
}

function normalizeContactFormConfig(configJson: unknown): ContactFormPluginConfig {
  const parsed = contactFormPluginConfigSchema.safeParse(configJson ?? {});
  if (parsed.success) return parsed.data;
  return contactFormPluginConfigSchema.parse({});
}

function withRecipientEmail(
  config: ContactFormPluginConfig,
  email: string,
): ContactFormPluginConfig {
  return {
    ...config,
    recipientEmails: normalizeUniqueEmails([...config.recipientEmails, email]),
  };
}

export interface ContactRecipientOption {
  email: string;
  isVerified: boolean;
  isPending: boolean;
}

export interface ContactPendingRecipient {
  email: string;
  lastSentAt: string | null;
}

export interface ContactRecipientDirectory {
  options: ContactRecipientOption[];
  pending: ContactPendingRecipient[];
}

export interface ContactRecipientVerificationRequestResult {
  email: string;
  status:
    | "already_verified"
    | "added_verified"
    | "verification_sent"
    | "verification_pending";
  cooldownRemainingSeconds: number;
}

export type ContactRecipientVerificationConsumeResult =
  | {
      status: "verified";
      email: string;
      projectSlug: string;
    }
  | {
      status: "invalid" | "expired";
    };

export class ContactRecipientEmailFormatError extends Error {
  constructor() {
    super("Please enter a valid email address.");
    this.name = "ContactRecipientEmailFormatError";
  }
}

export class ContactRecipientVerificationSendError extends Error {
  constructor() {
    super("Failed to send verification email. Please try again.");
    this.name = "ContactRecipientVerificationSendError";
  }
}

export class ContactRecipientVerificationPendingLimitError extends Error {
  constructor(limit: number) {
    super(`Too many pending recipient verifications (max ${limit}).`);
    this.name = "ContactRecipientVerificationPendingLimitError";
  }
}

class ContactFormRecipientVerificationService {
  private async listOrganizationEmails(options: {
    organizationId: string;
  }): Promise<{ email: string; emailVerified: boolean }[]> {
    const members = await db.query.organizationMember.findMany({
      where: eq(organizationMember.organizationId, options.organizationId),
      with: {
        user: {
          columns: {
            email: true,
            emailVerified: true,
          },
        },
      },
    });

    const seen = new Set<string>();
    const output: { email: string; emailVerified: boolean }[] = [];
    for (const member of members) {
      const email = normalizeEmailAddress(member.user.email);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      output.push({
        email,
        emailVerified: !!member.user.emailVerified,
      });
    }
    return output.sort((left, right) => left.email.localeCompare(right.email));
  }

  private async addRecipientToPluginConfig(options: {
    pluginInstanceId: string;
    email: string;
  }): Promise<void> {
    const pluginInstance = await db.query.projectPluginInstance.findFirst({
      where: eq(projectPluginInstance.id, options.pluginInstanceId),
      columns: {
        id: true,
        configJson: true,
      },
    });
    if (!pluginInstance) return;

    const normalizedConfig = normalizeContactFormConfig(pluginInstance.configJson);
    const nextConfig = withRecipientEmail(normalizedConfig, options.email);
    if (
      nextConfig.recipientEmails.length === normalizedConfig.recipientEmails.length &&
      nextConfig.recipientEmails.every(
        (email, index) => email === normalizedConfig.recipientEmails[index],
      )
    ) {
      return;
    }

    await db
      .update(projectPluginInstance)
      .set({
        configJson: nextConfig,
        updatedAt: new Date(),
      })
      .where(eq(projectPluginInstance.id, pluginInstance.id));
  }

  async listRecipientDirectory(options: {
    organizationId: string;
    projectSlug: string;
    verifiedRecipientEmails: string[];
  }): Promise<ContactRecipientDirectory> {
    const normalizedVerifiedEmails = normalizeUniqueEmails(options.verifiedRecipientEmails);
    const [organizationEmails, pendingRows] = await Promise.all([
      this.listOrganizationEmails({ organizationId: options.organizationId }),
      db.query.contactFormRecipientVerification.findMany({
        where: and(
          eq(contactFormRecipientVerification.organizationId, options.organizationId),
          eq(contactFormRecipientVerification.projectSlug, options.projectSlug),
          eq(contactFormRecipientVerification.status, "pending"),
        ),
        columns: {
          email: true,
          lastSentAt: true,
        },
      }),
    ]);

    const verifiedEmailSet = new Set(normalizedVerifiedEmails);
    const pendingEntries = pendingRows
      .map((row) => ({
        email: normalizeEmailAddress(row.email),
        lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null,
      }))
      .filter((row) => row.email.length > 0)
      .sort((left, right) => left.email.localeCompare(right.email));
    const pendingEmailSet = new Set(pendingEntries.map((entry) => entry.email));

    const optionEmailSet = new Set<string>();
    for (const row of organizationEmails) optionEmailSet.add(row.email);
    for (const email of normalizedVerifiedEmails) optionEmailSet.add(email);
    for (const email of pendingEmailSet) optionEmailSet.add(email);

    const optionsList = Array.from(optionEmailSet)
      .sort((left, right) => left.localeCompare(right))
      .map((email) => ({
        email,
        isVerified: verifiedEmailSet.has(email),
        isPending: !verifiedEmailSet.has(email) && pendingEmailSet.has(email),
      }));

    return {
      options: optionsList,
      pending: pendingEntries.filter((entry) => !verifiedEmailSet.has(entry.email)),
    };
  }

  async listVerifiedExternalRecipientEmailSet(options: {
    organizationId: string;
    projectSlug: string;
    recipientEmails: string[];
  }): Promise<Set<string>> {
    const normalizedEmails = normalizeUniqueEmails(options.recipientEmails);
    if (normalizedEmails.length === 0) {
      return new Set<string>();
    }

    const rows = await db.query.contactFormRecipientVerification.findMany({
      where: and(
        eq(contactFormRecipientVerification.organizationId, options.organizationId),
        eq(contactFormRecipientVerification.projectSlug, options.projectSlug),
        eq(contactFormRecipientVerification.status, "verified"),
        inArray(contactFormRecipientVerification.email, normalizedEmails),
      ),
      columns: {
        email: true,
      },
    });

    return new Set(rows.map((row) => normalizeEmailAddress(row.email)));
  }

  async requestRecipientVerification(options: {
    organizationId: string;
    projectSlug: string;
    pluginInstanceId: string;
    email: string;
    requestedByUserId?: string | null;
  }): Promise<ContactRecipientVerificationRequestResult> {
    const normalizedEmail = normalizeEmailAddress(options.email);
    if (!recipientEmailSchema.safeParse(normalizedEmail).success) {
      throw new ContactRecipientEmailFormatError();
    }

    const pluginInstance = await db.query.projectPluginInstance.findFirst({
      where: and(
        eq(projectPluginInstance.id, options.pluginInstanceId),
        eq(projectPluginInstance.organizationId, options.organizationId),
        eq(projectPluginInstance.projectSlug, options.projectSlug),
        eq(projectPluginInstance.pluginId, "contact_form"),
      ),
      columns: {
        id: true,
        configJson: true,
      },
    });
    if (!pluginInstance) {
      throw new Error("Contact Form plugin instance not found");
    }

    const config = normalizeContactFormConfig(pluginInstance.configJson);
    const currentRecipients = new Set(
      config.recipientEmails.map((value) => normalizeEmailAddress(value)),
    );
    if (currentRecipients.has(normalizedEmail)) {
      return {
        email: normalizedEmail,
        status: "already_verified",
        cooldownRemainingSeconds: 0,
      };
    }

    const orgEmails = await this.listOrganizationEmails({
      organizationId: options.organizationId,
    });
    const verifiedOrgEmailSet = new Set(
      orgEmails.filter((row) => row.emailVerified).map((row) => row.email),
    );
    if (verifiedOrgEmailSet.has(normalizedEmail)) {
      await this.addRecipientToPluginConfig({
        pluginInstanceId: pluginInstance.id,
        email: normalizedEmail,
      });
      await db
        .update(contactFormRecipientVerification)
        .set({
          status: "verified",
          verificationTokenHash: null,
          verificationTokenExpiresAt: null,
          verifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(contactFormRecipientVerification.organizationId, options.organizationId),
            eq(contactFormRecipientVerification.projectSlug, options.projectSlug),
            eq(contactFormRecipientVerification.email, normalizedEmail),
          ),
        );

      return {
        email: normalizedEmail,
        status: "added_verified",
        cooldownRemainingSeconds: 0,
      };
    }

    const existing = await db.query.contactFormRecipientVerification.findFirst({
      where: and(
        eq(contactFormRecipientVerification.organizationId, options.organizationId),
        eq(contactFormRecipientVerification.projectSlug, options.projectSlug),
        eq(contactFormRecipientVerification.email, normalizedEmail),
      ),
      columns: {
        id: true,
        status: true,
        lastSentAt: true,
      },
    });

    if (existing?.status === "verified") {
      await this.addRecipientToPluginConfig({
        pluginInstanceId: pluginInstance.id,
        email: normalizedEmail,
      });
      return {
        email: normalizedEmail,
        status: "added_verified",
        cooldownRemainingSeconds: 0,
      };
    }

    if (!existing) {
      const pendingCountRows = await db
        .select({
          count: sql<number>`count(*)`,
        })
        .from(contactFormRecipientVerification)
        .where(
          and(
            eq(contactFormRecipientVerification.organizationId, options.organizationId),
            eq(contactFormRecipientVerification.projectSlug, options.projectSlug),
            eq(contactFormRecipientVerification.status, "pending"),
          ),
        );

      const pendingCount = Number(pendingCountRows[0]?.count ?? 0);
      if (pendingCount >= maxPendingPerProject) {
        throw new ContactRecipientVerificationPendingLimitError(maxPendingPerProject);
      }
    }

    const now = new Date();
    if (existing?.lastSentAt) {
      const elapsedMs = now.getTime() - existing.lastSentAt.getTime();
      const cooldownMs = resendCooldownSeconds * 1000;
      if (elapsedMs < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsedMs) / 1000);
        return {
          email: normalizedEmail,
          status: "verification_pending",
          cooldownRemainingSeconds: Math.max(0, remaining),
        };
      }
    }

    const verificationToken = generateVerificationToken();
    const verificationTokenHash = hashToken(verificationToken);
    const expiresAt = new Date(now.getTime() + tokenExpirySeconds * 1000);
    let verificationRowId = existing?.id ?? null;

    if (existing) {
      await db
        .update(contactFormRecipientVerification)
        .set({
          pluginInstanceId: pluginInstance.id,
          status: "pending",
          verificationTokenHash,
          verificationTokenExpiresAt: expiresAt,
          lastSentAt: now,
          verifiedAt: null,
          updatedAt: now,
        })
        .where(eq(contactFormRecipientVerification.id, existing.id));
    } else {
      const newRowId = randomUUID();
      verificationRowId = newRowId;
      await db.insert(contactFormRecipientVerification).values({
        id: newRowId,
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginInstanceId: pluginInstance.id,
        email: normalizedEmail,
        status: "pending",
        verificationTokenHash,
        verificationTokenExpiresAt: expiresAt,
        lastSentAt: now,
        verifiedAt: null,
        createdByUserId: options.requestedByUserId ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }

    const verificationEndpoint = getContactRecipientVerificationEndpoint();
    const verificationUrl = `${verificationEndpoint}?token=${encodeURIComponent(
      verificationToken,
    )}`;
    const template = buildContactRecipientVerificationEmail({
      projectSlug: options.projectSlug,
      verificationUrl,
      expiresInSeconds: tokenExpirySeconds,
    });
    const emailService = getEmailDeliveryService();
    const emailResult = await emailService.send({
      to: [normalizedEmail],
      subject: template.subject,
      text: template.text,
      html: template.html,
      metadata: {
        category: "contact_recipient_verification",
        plugin: "contact_form",
        organization: options.organizationId,
        project: options.projectSlug,
      },
    });
    if (!emailResult.accepted) {
      console.error("[ContactRecipientVerification] Failed to send verification email", {
        provider: emailResult.provider,
        error: emailResult.error,
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        email: normalizedEmail,
      });
      if (existing) {
        await db
          .update(contactFormRecipientVerification)
          .set({
            verificationTokenHash: null,
            verificationTokenExpiresAt: null,
            lastSentAt: existing.lastSentAt ?? null,
            updatedAt: new Date(),
          })
          .where(eq(contactFormRecipientVerification.id, existing.id));
      } else if (verificationRowId) {
        await db
          .delete(contactFormRecipientVerification)
          .where(eq(contactFormRecipientVerification.id, verificationRowId));
      }
      throw new ContactRecipientVerificationSendError();
    }

    return {
      email: normalizedEmail,
      status: "verification_sent",
      cooldownRemainingSeconds: 0,
    };
  }

  async verifyRecipientByToken(
    token: string,
  ): Promise<ContactRecipientVerificationConsumeResult> {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      return { status: "invalid" };
    }

    const tokenHash = hashToken(normalizedToken);
    const row = await db.query.contactFormRecipientVerification.findFirst({
      where: and(
        eq(contactFormRecipientVerification.verificationTokenHash, tokenHash),
        eq(contactFormRecipientVerification.status, "pending"),
      ),
      columns: {
        id: true,
        email: true,
        projectSlug: true,
        pluginInstanceId: true,
        verificationTokenExpiresAt: true,
      },
    });

    if (!row) {
      return { status: "invalid" };
    }

    const now = new Date();
    if (!row.verificationTokenExpiresAt || row.verificationTokenExpiresAt <= now) {
      await db
        .update(contactFormRecipientVerification)
        .set({
          verificationTokenHash: null,
          verificationTokenExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(contactFormRecipientVerification.id, row.id));
      return { status: "expired" };
    }

    const normalizedEmail = normalizeEmailAddress(row.email);
    const pluginInstance = await db.query.projectPluginInstance.findFirst({
      where: eq(projectPluginInstance.id, row.pluginInstanceId),
      columns: {
        id: true,
        configJson: true,
      },
    });
    if (!pluginInstance) {
      return { status: "invalid" };
    }

    const config = normalizeContactFormConfig(pluginInstance.configJson);
    const nextConfig = withRecipientEmail(config, normalizedEmail);

    let verified = false;
    await db.transaction(async (tx) => {
      const [updatedVerification] = await tx
        .update(contactFormRecipientVerification)
        .set({
          status: "verified",
          verificationTokenHash: null,
          verificationTokenExpiresAt: null,
          verifiedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(contactFormRecipientVerification.id, row.id),
            eq(contactFormRecipientVerification.status, "pending"),
            eq(contactFormRecipientVerification.verificationTokenHash, tokenHash),
          ),
        )
        .returning({ id: contactFormRecipientVerification.id });
      if (!updatedVerification) return;

      await tx
        .update(projectPluginInstance)
        .set({
          configJson: nextConfig,
          updatedAt: now,
        })
        .where(eq(projectPluginInstance.id, pluginInstance.id));

      verified = true;
    });

    if (!verified) {
      return { status: "invalid" };
    }

    return {
      status: "verified",
      email: normalizedEmail,
      projectSlug: row.projectSlug,
    };
  }
}

export const contactFormRecipientVerificationService =
  new ContactFormRecipientVerificationService();
