import { describe, expect, it, vi } from "vitest";
import { sendPreviewLeaveBeacon } from "./previewLeave";

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(blob);
  });
}

describe("sendPreviewLeaveBeacon", () => {
  it("sends the cleanup beacon for a valid project/version", async () => {
    const sendBeacon = vi.fn(() => true);

    const result = sendPreviewLeaveBeacon({
      projectSlug: "test-project",
      version: 2,
      sendBeacon,
    });

    expect(result).toBe(true);
    expect(sendBeacon).toHaveBeenCalledTimes(1);

    const calls = sendBeacon.mock.calls as unknown[][];
    const url = calls[0]?.[0];
    const payload = calls[0]?.[1];
    expect(url).toBe("/vivd-studio/api/cleanup/preview-leave");
    expect(payload).toBeInstanceOf(Blob);
    if (typeof url !== "string" || !(payload instanceof Blob)) {
      throw new Error("Expected cleanup payload to be a Blob");
    }
    await expect(readBlobAsText(payload)).resolves.toBe(
      JSON.stringify({
        slug: "test-project",
        version: 2,
      }),
    );
  });

  it("does not send a beacon when the project slug is missing", () => {
    const sendBeacon = vi.fn(() => true);

    const result = sendPreviewLeaveBeacon({
      projectSlug: "   ",
      version: 1,
      sendBeacon,
    });

    expect(result).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("does not send a beacon when the version is invalid", () => {
    const sendBeacon = vi.fn(() => true);

    const result = sendPreviewLeaveBeacon({
      projectSlug: "test-project",
      version: 0,
      sendBeacon,
    });

    expect(result).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
