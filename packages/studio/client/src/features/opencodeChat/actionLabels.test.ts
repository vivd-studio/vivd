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

    expect(result.title).toBe("Deploy to example.com");
    expect(result.summary).toContain("example.com");
    expect(result.technicalPatterns).toEqual([
      "vivd publish deploy --domain example.com",
    ]);
  });

  it("falls back to a generic technical-task label for unknown bash commands", () => {
    const result = resolvePermissionRequestDisplay(
      createPermissionRequest({
        patterns: ["npm run cms:validate"],
      }),
    );

    expect(result.title).toBe("Run a technical task");
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
      action: "Deploying",
      target: "to example.com...",
    });

    expect(
      resolveToolActivityLabelParts({
        toolName: "bash",
        status: "completed",
        toolInput: { command: "vivd publish deploy --domain example.com" },
      }),
    ).toEqual({
      action: "Deployed",
      target: "to example.com",
    });
  });

  it("uses a generic label for unknown bash commands", () => {
    expect(
      resolveToolActivityLabelParts({
        toolName: "bash",
        status: "completed",
        toolInput: { command: "npm run cms:validate" },
      }),
    ).toEqual({
      action: "Completed",
      target: "technical task",
    });
  });
});
