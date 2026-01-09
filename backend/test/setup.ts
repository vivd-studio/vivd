// Global test setup for backend tests
import { config } from "dotenv";
config({ path: "../.env" }); // Load .env from project root

import { vi } from "vitest";

// Example: Mock console.log in tests if needed
// vi.spyOn(console, 'log').mockImplementation(() => {});
