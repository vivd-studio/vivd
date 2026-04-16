import { describe, expect, it } from "vitest";
import {
  resolvePermissionRequestDisplay,
  resolveToolActivityLabelParts,
} from "./actionLabels";
import type { OpenCodePermissionRequest } from "./types";

function createPermissionRequest(
  overrides?: Partial<OpenCodePermissionRequest>,
): OpenCodePermissionRequest {
  return {
    id: "perm-1",
    sessionID: "session-1",
    permission: "bash",
    patterns: [],
    always: [],
    metadata: {},
    ...overrides,
  };
}

describe("resolvePermissionRequestDisplay", () => {
  it("translates known publish deploy commands with domain arguments", () => {
    const result = resolvePermissionRequestDisplay(
      createPermissionRequest({
        patterns: ["vivd publish deploy --domain example.com"],
      }),
    );

    expect(result.title).toBe("Publish site");
    expect(result.summary).toBe("This will publish the current version to:");
    expect(result.destinationLabel).toBe("example.com");
    expect(result.destinationUrl).toBe("https://example.com");
    expect(result.technicalPatterns).toEqual([
      "vivd publish deploy --domain example.com",
    ]);
  });

  it("uses the provided description for unknown bash permissions", () => {
    const result = resolvePermissionRequestDisplay(
      createPermissionRequest({
        patterns: ["npm run cms:validate"],
        metadata: { description: "Validate the CMS content" },
      }),
    );

    expect(result.title).toBe("Validate the CMS content");
    expect(result.showTechnicalDetails).toBe(true);
  });
});

describe("resolveToolActivityLabelParts", () => {
  it("builds argument-aware labels for known publish deploy commands", () => {
    expect(
      resolveToolActivityLabelParts({
        toolName: "bash",
        status: "running",
        toolInput: { command: "vivd publish deploy --domain example.com" },
      }),
    ).toEqual({
      action: "Publishing",
      target: "to example.com...",
    });

    expect(
      resolveToolActivityLabelParts({
        toolName: "bash",
        status: "completed",
        toolInput: { command: "vivd publish deploy --domain example.com" },
      }),
    ).toEqual({
      action: "Published",
      target: "to example.com",
    });
  });

  it("uses the description itself for unknown bash commands", () => {
    expect(
      resolveToolActivityLabelParts({
        toolName: "bash",
        status: "completed",
        toolInput: {
          command: "npm run cms:validate",
          description: "Validate the CMS schema and content.",
        },
      }),
    ).toEqual({
      action: "Validate the CMS schema and content.",
    });
  });
});
