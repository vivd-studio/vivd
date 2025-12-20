import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";

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
  trustedOrigins: [
    process.env.DOMAIN
      ? process.env.DOMAIN.startsWith("http")
        ? process.env.DOMAIN
        : `https://${process.env.DOMAIN}`
      : "http://localhost:5173",
  ],
  plugins: [admin()],
});
