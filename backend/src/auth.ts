import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { publishedSite } from "./db/schema";

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
        before: async (user) => {
          const existingUser = await db.query.user.findFirst();
          // first user is admin
          if (!existingUser) {
            return {
              data: {
                ...user,
                role: "admin",
              },
            };
          }
          return {
            data: {
              ...user,
            },
          };
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  // Dynamic trusted origins - supports multiple domains for published sites
  trustedOrigins: getTrustedOrigins,
  plugins: [admin()],
});
