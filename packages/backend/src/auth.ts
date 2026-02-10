import { betterAuth } from "better-auth";
import { admin, createAccessControl } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { organizationMember, publishedSite } from "./db/schema";
import { APIError } from "better-call";

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

/**
 * Build list of trusted origins dynamically.
 * Includes: main DOMAIN, TRUSTED_DOMAINS env var, and all published site domains.
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

  // Add all published site domains from database
  try {
    const published = await db
      .select({ domain: publishedSite.domain })
      .from(publishedSite);
    published.forEach((site) => {
      origins.push(`https://${site.domain}`, `http://${site.domain}`);
    });
  } catch (error) {
    // Database might not be ready during initial startup
    console.warn("Could not fetch published sites for trusted origins:", error);
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
