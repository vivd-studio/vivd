// Global test setup for backend tests
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Use __dirname equivalent for ESM to ensure consistent path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "../../../.env") }); // Load .env from repo root

import { vi } from "vitest";

// Example: Mock console.log in tests if needed
// vi.spyOn(console, 'log').mockImplementation(() => {});
