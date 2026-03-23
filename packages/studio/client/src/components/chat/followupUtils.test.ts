import { beforeEach, describe, expect, it } from "vitest";
import {
  buildQueuedFollowupPreview,
  FOLLOWUP_BEHAVIOR_STORAGE_KEY,
  getStoredFollowupBehavior,
} from "./followupUtils";

describe("followupUtils", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults follow-up behavior to steer", () => {
    expect(getStoredFollowupBehavior()).toBe("steer");
  });

  it("reads a persisted queue behavior", () => {
    window.localStorage.setItem(FOLLOWUP_BEHAVIOR_STORAGE_KEY, "queue");

    expect(getStoredFollowupBehavior()).toBe("queue");
  });

  it("builds previews from the first non-empty line", () => {
    expect(
      buildQueuedFollowupPreview("\n\nPolish the hero copy\nAdd more urgency"),
    ).toBe("Polish the hero copy");
  });

  it("falls back to an attachment label when only internal tags remain", () => {
    expect(
      buildQueuedFollowupPreview(
        '<vivd-internal type="attached-file" filename="brief.txt" path="docs/brief.txt" />',
      ),
    ).toBe("[Attachment]");
  });
});
