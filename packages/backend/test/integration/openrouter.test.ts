/**
 * OpenRouter Integration Test
 *
 * This test makes a real API call to OpenRouter using a cheap/free model
 * to verify the integration is working correctly.
 *
 * Run with:
 *   VIVD_RUN_INTEGRATION_TESTS=1 npm test
 * (or: npm run test:integration -w @vivd/backend -- test/integration/openrouter.test.ts)
 *
 * Note: Requires OPENROUTER_API_KEY to be set in environment.
 * Skips automatically unless explicitly opted in.
 */
import { describe, it, expect, beforeAll } from "vitest";
import OpenAI from "openai";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const RUN_INTEGRATION = process.env.VIVD_RUN_INTEGRATION_TESTS === "1";
const TEST_MODEL = "google/gemma-3-12b-it:free"; // Free model for testing

describe("OpenRouter Integration", () => {
  let openai: OpenAI;

  beforeAll(() => {
    if (!RUN_INTEGRATION) {
      console.log(
        "Skipping OpenRouter tests: set VIVD_RUN_INTEGRATION_TESTS=1 to enable",
      );
      return;
    }
    if (!OPENROUTER_API_KEY) {
      console.log("Skipping OpenRouter tests: OPENROUTER_API_KEY not set");
    }
  });

  it.skipIf(!RUN_INTEGRATION || !OPENROUTER_API_KEY)(
    "connects to OpenRouter and gets a response",
    { timeout: 30000 },
    async () => {
      openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: OPENROUTER_API_KEY,
      });

      const completion = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages: [
          {
            role: "user",
            content: 'Reply with exactly the word "pong" and nothing else.',
          },
        ],
        max_tokens: 10,
      });

      expect(completion.choices).toBeDefined();
      expect(completion.choices.length).toBeGreaterThan(0);
      expect(completion.choices[0]!.message.content).toBeDefined();

      const response =
        completion.choices[0]!.message.content?.toLowerCase() ?? "";
      expect(response).toContain("pong");
    },
  );

  it.skipIf(!RUN_INTEGRATION || !OPENROUTER_API_KEY)(
    "handles structured prompt correctly",
    { timeout: 30000 },
    async () => {
      openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: OPENROUTER_API_KEY,
      });

      const completion = await openai.chat.completions.create({
        model: TEST_MODEL,
        messages: [
          {
            role: "user",
            content: "What is 2 + 2? Reply with just the number.",
          },
        ],
        max_tokens: 10,
      });

      const response = completion.choices[0]!.message.content ?? "";
      expect(response).toContain("4");
    },
  );
});
