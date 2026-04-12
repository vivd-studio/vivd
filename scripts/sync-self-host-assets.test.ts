import test from "node:test";
import assert from "node:assert/strict";
import { renderSoloSelfHostComposeBundle } from "./sync-self-host-assets.ts";

const requiredModelEnvNames = [
  "OPENCODE_MODEL_STANDARD",
  "OPENCODE_MODEL_STANDARD_VARIANT",
  "OPENCODE_MODEL_ADVANCED",
  "OPENCODE_MODEL_ADVANCED_VARIANT",
  "OPENCODE_MODEL_PRO",
  "OPENCODE_MODEL_PRO_VARIANT",
] as const;

test("solo self-host compose bundle keeps the full OpenCode model env surface", () => {
  const compose = renderSoloSelfHostComposeBundle();

  for (const name of requiredModelEnvNames) {
    assert.ok(
      compose.includes(`      - ${name}=\${${name}:-}`),
      `${name} is missing from the generated self-host compose bundle`,
    );
  }
});
