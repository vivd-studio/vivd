import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

// Drizzle-kit runs from the workspace directory (`packages/backend`) when invoked via
// `npm run ... -w @vivd/backend`, while local tooling may run from repo root.
// Load both without relying on `__dirname` (drizzle-kit config loader may run in ESM-only mode).
dotenv.config();
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: "../../.env" });
}

export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
});
