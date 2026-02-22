import { betterAuth } from "better-auth";
import { admin, createAccessControl } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { domain, organizationMember } from "./db/schema";
import { APIError } from "better-call";
import { eq } from "drizzle-orm";
import { getEmailDeliveryService } from "./services/integrations/EmailDeliveryService";
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
} from "./services/email/templates";

const adminStatements = {
  user: [
    "create",
    "list",
    "set-role",
    "ban",
    "impersonate",
    "delete",
    "set-password",
    "get",
    "update",
  ],
  session: ["list", "revoke", "delete"],
} as const;

const adminAccessControl = createAccessControl(adminStatements);
const superAdminAccess = adminAccessControl.newRole({
  user: [...adminStatements.user],
  session: [...adminStatements.session],
});
const noAdminAccess = adminAccessControl.newRole({ user: [], session: [] });
const DEFAULT_AUTH_TOKEN_EXPIRES_IN_SECONDS = 3_600;

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const authEmailVerificationExpiresInSeconds = readPositiveIntEnv(
  "VIVD_AUTH_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS",
  DEFAULT_AUTH_TOKEN_EXPIRES_IN_SECONDS,
);
const authResetPasswordExpiresInSeconds = readPositiveIntEnv(
  "VIVD_AUTH_RESET_PASSWORD_EXPIRES_IN_SECONDS",
  DEFAULT_AUTH_TOKEN_EXPIRES_IN_SECONDS,
);
const authRequireEmailVerification = readBooleanEnv(
  "VIVD_AUTH_REQUIRE_EMAIL_VERIFICATION",
  false,
);
const authSendVerificationOnSignup = readBooleanEnv(
  "VIVD_AUTH_EMAIL_VERIFICATION_SEND_ON_SIGNUP",
  true,
);
const authSendVerificationOnSignIn = readBooleanEnv(
  "VIVD_AUTH_EMAIL_VERIFICATION_SEND_ON_SIGNIN",
  false,
);
const authAutoSignInAfterVerification = readBooleanEnv(
  "VIVD_AUTH_EMAIL_VERIFICATION_AUTO_SIGNIN",
  false,
);
const authRevokeSessionsOnPasswordReset = readBooleanEnv(
  "VIVD_AUTH_REVOKE_SESSIONS_ON_PASSWORD_RESET",
  true,
);

async function sendTransactionalAuthEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  metadata: Record<string, string>;
}) {
  const emailService = getEmailDeliveryService();
  const result = await emailService.send({
    to: [input.to],
    subject: input.subject,
    text: input.text,
    html: input.html,
    metadata: input.metadata,
  });

  if (!result.accepted) {
    console.error("[Auth] Transactional email delivery failed", {
      provider: result.provider,
      error: result.error,
      to: input.to,
      metadata: input.metadata,
    });
  }
}

/**
 * Build list of trusted origins dynamically.
 * Includes: main DOMAIN, TRUSTED_DOMAINS env var, and all active registered domains.
 */
async function getTrustedOrigins(): Promise<string[]> {
  const origins: string[] = [];

  // Add main DOMAIN from env
  if (process.env.DOMAIN) {
    const mainDomain = process.env.DOMAIN.startsWith("http")
      ? process.env.DOMAIN
      : `https://${process.env.DOMAIN}`;
    origins.push(mainDomain);
  } else {
    // Development fallback
    origins.push("http://localhost:5173", "http://localhost");
  }

  // Add extra trusted domains from env (comma-separated)
  if (process.env.TRUSTED_DOMAINS) {
    process.env.TRUSTED_DOMAINS.split(",").forEach((d) => {
      const domain = d.trim();
      if (domain) {
        origins.push(`https://${domain}`, `http://${domain}`);
      }
    });
  }

  // Add all active domains from registry
  try {
    const rows = await db
      .select({ domain: domain.domain })
      .from(domain)
      .where(eq(domain.status, "active"));
    rows.forEach((site) => {
      origins.push(`https://${site.domain}`, `http://${site.domain}`);
    });
  } catch (error) {
    // Database might not be ready during initial startup.
    console.warn("Could not fetch registered domains for trusted origins:", error);
  }

  return origins;
}

export const auth = betterAuth({
  basePath: "/vivd-studio/api/auth",
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          const existingUser = await db.query.user.findFirst({
            columns: { id: true },
          });

          const isSignup = ctx?.path?.startsWith("/sign-up/") ?? false;
          if (existingUser && isSignup) {
            throw new APIError("BAD_REQUEST", {
              message: "Sign up is disabled",
            });
          }

          // First user bootstraps the install.
          if (!existingUser && isSignup) {
            return {
              data: {
                ...user,
                role: "super_admin",
              },
            };
          }

          return { data: { ...user } };
        },
        after: async (user, ctx) => {
          const isSignup = ctx?.path?.startsWith("/sign-up/") ?? false;
          if (!isSignup) return;

          // Attach bootstrap user to the default org as owner.
          await db
            .insert(organizationMember)
            .values({
              id: `default:${user.id}`,
              organizationId: "default",
              userId: user.id,
              role: "owner",
            })
            .onConflictDoNothing({
              target: [organizationMember.organizationId, organizationMember.userId],
            });
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: authRequireEmailVerification,
    resetPasswordTokenExpiresIn: authResetPasswordExpiresInSeconds,
    revokeSessionsOnPasswordReset: authRevokeSessionsOnPasswordReset,
    sendResetPassword: async ({ user, url }) => {
      const template = buildPasswordResetEmail({
        recipientName: user.name,
        resetUrl: url,
        expiresInSeconds: authResetPasswordExpiresInSeconds,
      });
      await sendTransactionalAuthEmail({
        to: user.email,
        subject: template.subject,
        text: template.text,
        html: template.html,
        metadata: {
          category: "auth_password_reset",
          userId: user.id,
        },
      });
    },
  },
  emailVerification: {
    sendOnSignUp: authSendVerificationOnSignup,
    sendOnSignIn: authSendVerificationOnSignIn,
    autoSignInAfterVerification: authAutoSignInAfterVerification,
    expiresIn: authEmailVerificationExpiresInSeconds,
    sendVerificationEmail: async ({ user, url }) => {
      const template = buildVerificationEmail({
        recipientName: user.name,
        verificationUrl: url,
        expiresInSeconds: authEmailVerificationExpiresInSeconds,
      });
      await sendTransactionalAuthEmail({
        to: user.email,
        subject: template.subject,
        text: template.text,
        html: template.html,
        metadata: {
          category: "auth_email_verification",
          userId: user.id,
        },
      });
    },
  },
  // Dynamic trusted origins - supports multiple domains for published sites
  trustedOrigins: getTrustedOrigins,
  plugins: [
    admin({
      adminRoles: ["super_admin"],
      roles: {
        super_admin: superAdminAccess,
        admin: noAdminAccess,
        user: noAdminAccess,
        client_editor: noAdminAccess,
      },
    }),
  ],
});
