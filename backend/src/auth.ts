import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
    }),
    databaseHooks: {
        user: {
            create: {
                before: async (user) => {
                    const existingUser = await db.query.user.findFirst();
                    if (!existingUser) {
                        return {
                            data: {
                                ...user,
                                role: "admin",
                            },
                        };
                    }
                    // Explicitly set check role is user just in case
                    return {
                        data: {
                            ...user,
                            role: "user"
                        }
                    };
                },
            },
        },
    },
    emailAndPassword: {
        enabled: true,
    },
    trustedOrigins: [process.env.FRONTEND_URL || "http://localhost:5173"],
});
