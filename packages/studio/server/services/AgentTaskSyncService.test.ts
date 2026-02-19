import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestBucketSyncAfterAgentTask } from "./AgentTaskSyncService.js";

const ORIGINAL_ENV = new Map<string, string | undefined>();

for (const key of [
  "VIVD_S3_BUCKET",
  "R2_BUCKET",
  "VIVD_S3_SOURCE_URI",
  "VIVD_S3_OPENCODE_URI",
  "VIVD_S3_OPENCODE_STORAGE_URI",
  "VIVD_SYNC_TRIGGER_FILE",
]) {
  ORIGINAL_ENV.set(key, process.env[key]);
}

afterEach(() => {
  for (const [key, value] of ORIGINAL_ENV) {
    if (typeof value === "string") process.env[key] = value;
    else delete process.env[key];
  }
});

describe("requestBucketSyncAfterAgentTask", () => {
  it("writes a sync trigger file when bucket sync is configured", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-sync-trigger-"));
    const triggerFile = path.join(tmpDir, "sync.trigger");
    process.env.VIVD_S3_BUCKET = "bucket";
    process.env.VIVD_SYNC_TRIGGER_FILE = triggerFile;

    const requested = requestBucketSyncAfterAgentTask({
      sessionId: "session-1",
      projectDir: "/workspace/project",
    });

    expect(requested).toBe(true);
    expect(fs.existsSync(triggerFile)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(triggerFile, "utf-8")) as {
      reason: string;
      sessionId: string;
      projectDir: string;
      at: string;
    };
    expect(payload.reason).toBe("agent-task-completed");
    expect(payload.sessionId).toBe("session-1");
    expect(payload.projectDir).toBe("/workspace/project");
    expect(typeof payload.at).toBe("string");
  });

  it("does nothing when bucket sync is not configured", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-sync-trigger-"));
    const triggerFile = path.join(tmpDir, "sync.trigger");
    delete process.env.VIVD_S3_BUCKET;
    delete process.env.R2_BUCKET;
    delete process.env.VIVD_S3_SOURCE_URI;
    delete process.env.VIVD_S3_OPENCODE_URI;
    delete process.env.VIVD_S3_OPENCODE_STORAGE_URI;
    process.env.VIVD_SYNC_TRIGGER_FILE = triggerFile;

    const requested = requestBucketSyncAfterAgentTask({
      sessionId: "session-2",
      projectDir: "/workspace/project",
    });

    expect(requested).toBe(false);
    expect(fs.existsSync(triggerFile)).toBe(false);
  });
});
