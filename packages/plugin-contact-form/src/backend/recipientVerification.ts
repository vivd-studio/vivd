import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  contactFormPluginConfigSchema,
  type ContactFormPluginConfig,
} from "./config";
import type {
  ContactFormRecipientVerificationServiceDeps,
  ContactFormRecipientVerificationTables,
} from "./ports";

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
    | "marked_verified"
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

type PendingRecipientRow = {
  email: string;
  lastSentAt: Date | null;
};

type VerifiedRecipientRow = {
  email: string;
};

class ContactFormRecipientVerificationServiceImpl {
  private readonly deps: ContactFormRecipientVerificationServiceDeps;

  constructor(deps: ContactFormRecipientVerificationServiceDeps) {
    this.deps = deps;
  }

  private get tables(): ContactFormRecipientVerificationTables {
    return this.deps.tables;
  }

  private async listOrganizationEmails(options: {
    organizationId: string;
  }): Promise<{ email: string; emailVerified: boolean }[]> {
    const members = await this.deps.db.query.organizationMember.findMany({
      where: eq(this.tables.organizationMember.organizationId, options.organizationId),
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
    const pluginInstance = await this.deps.db.query.projectPluginInstance.findFirst({
      where: eq(this.tables.projectPluginInstance.id, options.pluginInstanceId),
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

    await this.deps.db
      .update(this.tables.projectPluginInstance)
      .set({
        configJson: nextConfig,
        updatedAt: new Date(),
      })
      .where(eq(this.tables.projectPluginInstance.id, pluginInstance.id));
  }

  async listRecipientDirectory(options: {
    organizationId: string;
    projectSlug: string;
    verifiedRecipientEmails: string[];
  }): Promise<ContactRecipientDirectory> {
    const normalizedVerifiedEmails = normalizeUniqueEmails(options.verifiedRecipientEmails);
    const [organizationEmails, pendingRows] = await Promise.all([
      this.listOrganizationEmails({ organizationId: options.organizationId }),
      this.deps.db.query.contactFormRecipientVerification.findMany({
        where: and(
          eq(this.tables.contactFormRecipientVerification.organizationId, options.organizationId),
          eq(this.tables.contactFormRecipientVerification.projectSlug, options.projectSlug),
          eq(this.tables.contactFormRecipientVerification.status, "pending"),
        ),
        columns: {
          email: true,
          lastSentAt: true,
        },
      }),
    ]);

    const verifiedEmailSet = new Set(normalizedVerifiedEmails);
    const pendingEntries = (pendingRows as PendingRecipientRow[])
      .map((row: PendingRecipientRow) => ({
        email: normalizeEmailAddress(row.email),
        lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null,
      }))
      .filter((row) => row.email.length > 0)
      .sort((left, right) => left.email.localeCompare(right.email));
    const pendingEmailSet = new Set<string>(
      pendingEntries.map((entry) => entry.email),
    );

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

    const rows = await this.deps.db.query.contactFormRecipientVerification.findMany({
      where: and(
        eq(this.tables.contactFormRecipientVerification.organizationId, options.organizationId),
        eq(this.tables.contactFormRecipientVerification.projectSlug, options.projectSlug),
        eq(this.tables.contactFormRecipientVerification.status, "verified"),
        inArray(this.tables.contactFormRecipientVerification.email, normalizedEmails),
      ),
      columns: {
        email: true,
      },
    });

    return new Set(
      (rows as VerifiedRecipientRow[]).map((row: VerifiedRecipientRow) =>
        normalizeEmailAddress(row.email),
      ),
    );
  }

  async requestRecipientVerification(options: {
    organizationId: string;
    projectSlug: string;
    pluginInstanceId: string;
    email: string;
    requestedByUserId?: string | null;
    requestHost?: string | null;
  }): Promise<ContactRecipientVerificationRequestResult> {
    const normalizedEmail = normalizeEmailAddress(options.email);
    if (!recipientEmailSchema.safeParse(normalizedEmail).success) {
      throw new ContactRecipientEmailFormatError();
    }

    const pluginInstance = await this.deps.db.query.projectPluginInstance.findFirst({
      where: and(
        eq(this.tables.projectPluginInstance.id, options.pluginInstanceId),
        eq(this.tables.projectPluginInstance.organizationId, options.organizationId),
        eq(this.tables.projectPluginInstance.projectSlug, options.projectSlug),
        eq(this.tables.projectPluginInstance.pluginId, "contact_form"),
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
      await this.deps.db
        .update(this.tables.contactFormRecipientVerification)
        .set({
          status: "verified",
          verificationTokenHash: null,
          verificationTokenExpiresAt: null,
          verifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(this.tables.contactFormRecipientVerification.organizationId, options.organizationId),
            eq(this.tables.contactFormRecipientVerification.projectSlug, options.projectSlug),
            eq(this.tables.contactFormRecipientVerification.email, normalizedEmail),
          ),
        );

      return {
        email: normalizedEmail,
        status: "added_verified",
        cooldownRemainingSeconds: 0,
      };
    }

    const existing = await this.deps.db.query.contactFormRecipientVerification.findFirst({
      where: and(
        eq(this.tables.contactFormRecipientVerification.organizationId, options.organizationId),
        eq(this.tables.contactFormRecipientVerification.projectSlug, options.projectSlug),
        eq(this.tables.contactFormRecipientVerification.email, normalizedEmail),
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
      const pendingCountRows = await this.deps.db
        .select({
          count: sql<number>`count(*)`,
        })
        .from(this.tables.contactFormRecipientVerification)
        .where(
          and(
            eq(this.tables.contactFormRecipientVerification.organizationId, options.organizationId),
            eq(this.tables.contactFormRecipientVerification.projectSlug, options.projectSlug),
            eq(this.tables.contactFormRecipientVerification.status, "pending"),
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

    const verificationEndpoint = this.deps.getContactRecipientVerificationEndpoint({
      requestHost: options.requestHost,
    });

    const verificationToken = generateVerificationToken();
    const verificationTokenHash = hashToken(verificationToken);
    const expiresAt = new Date(now.getTime() + tokenExpirySeconds * 1000);
    let verificationRowId = existing?.id ?? null;

    if (existing) {
      await this.deps.db
        .update(this.tables.contactFormRecipientVerification)
        .set({
          pluginInstanceId: pluginInstance.id,
          status: "pending",
          verificationTokenHash,
          verificationTokenExpiresAt: expiresAt,
          lastSentAt: now,
          verifiedAt: null,
          updatedAt: now,
        })
        .where(eq(this.tables.contactFormRecipientVerification.id, existing.id));
    } else {
      const newRowId = randomUUID();
      verificationRowId = newRowId;
      await this.deps.db.insert(this.tables.contactFormRecipientVerification).values({
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

    const verificationUrl = `${verificationEndpoint}?token=${encodeURIComponent(
      verificationToken,
    )}`;
    const template = await this.deps.buildRecipientVerificationEmail({
      projectSlug: options.projectSlug,
      verificationUrl,
      expiresInSeconds: tokenExpirySeconds,
    });
    const emailResult = await this.deps.emailDeliveryService.send({
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
        await this.deps.db
          .update(this.tables.contactFormRecipientVerification)
          .set({
            verificationTokenHash: null,
            verificationTokenExpiresAt: null,
            lastSentAt: existing.lastSentAt ?? null,
            updatedAt: new Date(),
          })
          .where(eq(this.tables.contactFormRecipientVerification.id, existing.id));
      } else if (verificationRowId) {
        await this.deps.db
          .delete(this.tables.contactFormRecipientVerification)
          .where(eq(this.tables.contactFormRecipientVerification.id, verificationRowId));
      }
      throw new ContactRecipientVerificationSendError();
    }

    return {
      email: normalizedEmail,
      status: "verification_sent",
      cooldownRemainingSeconds: 0,
    };
  }

  async markRecipientVerified(options: {
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

    const pluginInstance = await this.deps.db.query.projectPluginInstance.findFirst({
      where: and(
        eq(this.tables.projectPluginInstance.id, options.pluginInstanceId),
        eq(this.tables.projectPluginInstance.organizationId, options.organizationId),
        eq(this.tables.projectPluginInstance.projectSlug, options.projectSlug),
        eq(this.tables.projectPluginInstance.pluginId, "contact_form"),
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
    const existing = await this.deps.db.query.contactFormRecipientVerification.findFirst({
      where: and(
        eq(this.tables.contactFormRecipientVerification.organizationId, options.organizationId),
        eq(this.tables.contactFormRecipientVerification.projectSlug, options.projectSlug),
        eq(this.tables.contactFormRecipientVerification.email, normalizedEmail),
      ),
      columns: {
        id: true,
        status: true,
      },
    });

    const orgEmails = await this.listOrganizationEmails({
      organizationId: options.organizationId,
    });
    const verifiedOrgEmailSet = new Set(
      orgEmails.filter((row) => row.emailVerified).map((row) => row.email),
    );

    if (
      currentRecipients.has(normalizedEmail) &&
      (verifiedOrgEmailSet.has(normalizedEmail) || existing?.status === "verified")
    ) {
      return {
        email: normalizedEmail,
        status: "already_verified",
        cooldownRemainingSeconds: 0,
      };
    }

    if (verifiedOrgEmailSet.has(normalizedEmail) || existing?.status === "verified") {
      await this.addRecipientToPluginConfig({
        pluginInstanceId: pluginInstance.id,
        email: normalizedEmail,
      });

      if (existing) {
        await this.deps.db
          .update(this.tables.contactFormRecipientVerification)
          .set({
            pluginInstanceId: pluginInstance.id,
            status: "verified",
            verificationTokenHash: null,
            verificationTokenExpiresAt: null,
            verifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(this.tables.contactFormRecipientVerification.id, existing.id));
      }

      return {
        email: normalizedEmail,
        status: "added_verified",
        cooldownRemainingSeconds: 0,
      };
    }

    const now = new Date();
    const nextConfig = withRecipientEmail(config, normalizedEmail);

    await this.deps.db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(this.tables.contactFormRecipientVerification)
          .set({
            pluginInstanceId: pluginInstance.id,
            status: "verified",
            verificationTokenHash: null,
            verificationTokenExpiresAt: null,
            verifiedAt: now,
            updatedAt: now,
          })
          .where(eq(this.tables.contactFormRecipientVerification.id, existing.id));
      } else {
        await tx.insert(this.tables.contactFormRecipientVerification).values({
          id: randomUUID(),
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginInstanceId: pluginInstance.id,
          email: normalizedEmail,
          status: "verified",
          verificationTokenHash: null,
          verificationTokenExpiresAt: null,
          lastSentAt: null,
          verifiedAt: now,
          createdByUserId: options.requestedByUserId ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }

      await tx
        .update(this.tables.projectPluginInstance)
        .set({
          configJson: nextConfig,
          updatedAt: now,
        })
        .where(eq(this.tables.projectPluginInstance.id, pluginInstance.id));
    });

    return {
      email: normalizedEmail,
      status: "marked_verified",
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
    const row = await this.deps.db.query.contactFormRecipientVerification.findFirst({
      where: and(
        eq(this.tables.contactFormRecipientVerification.verificationTokenHash, tokenHash),
        eq(this.tables.contactFormRecipientVerification.status, "pending"),
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
      await this.deps.db
        .update(this.tables.contactFormRecipientVerification)
        .set({
          verificationTokenHash: null,
          verificationTokenExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(this.tables.contactFormRecipientVerification.id, row.id));
      return { status: "expired" };
    }

    const normalizedEmail = normalizeEmailAddress(row.email);
    const pluginInstance = await this.deps.db.query.projectPluginInstance.findFirst({
      where: eq(this.tables.projectPluginInstance.id, row.pluginInstanceId),
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
    await this.deps.db.transaction(async (tx) => {
      const [updatedVerification] = await tx
        .update(this.tables.contactFormRecipientVerification)
        .set({
          status: "verified",
          verificationTokenHash: null,
          verificationTokenExpiresAt: null,
          verifiedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(this.tables.contactFormRecipientVerification.id, row.id),
            eq(this.tables.contactFormRecipientVerification.status, "pending"),
            eq(this.tables.contactFormRecipientVerification.verificationTokenHash, tokenHash),
          ),
        )
        .returning({ id: this.tables.contactFormRecipientVerification.id });
      if (!updatedVerification) return;

      await tx
        .update(this.tables.projectPluginInstance)
        .set({
          configJson: nextConfig,
          updatedAt: now,
        })
        .where(eq(this.tables.projectPluginInstance.id, pluginInstance.id));

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

export function createContactFormRecipientVerificationService(
  deps: ContactFormRecipientVerificationServiceDeps,
) {
  return new ContactFormRecipientVerificationServiceImpl(deps);
}

export type ContactFormRecipientVerificationService = ReturnType<
  typeof createContactFormRecipientVerificationService
>;
