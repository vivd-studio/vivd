import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { db } from "./db/index.js";

async function getTrustedOrigins(): Promise<string[]> {
  const origins: string[] = ["http://localhost:5174", "http://localhost"];

  if (process.env.BETTER_AUTH_URL) {
    try {
      origins.push(new URL(process.env.BETTER_AUTH_URL).origin);
    } catch {
      origins.push(process.env.BETTER_AUTH_URL);
    }
  }

  return origins;
}

function getBaseUrlFromEnv(): string | undefined {
  if (!process.env.BETTER_AUTH_URL) return undefined;
  try {
    return new URL(process.env.BETTER_AUTH_URL).origin;
  } catch {
    return process.env.BETTER_AUTH_URL;
  }
}

export const auth = betterAuth({
  basePath: "/auth",
  baseURL: getBaseUrlFromEnv(),
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const existingUser = await db.query.user.findFirst();
          // First user becomes admin
          if (!existingUser) {
            return {
              data: {
                ...user,
                role: "admin",
              },
            };
          }
          return { data: user };
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: getTrustedOrigins,
  plugins: [admin()],
});
