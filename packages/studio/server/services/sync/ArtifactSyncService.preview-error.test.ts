import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  spawnMock,
  spawnSyncMock,
  detectProjectTypeMock,
  hasNodeModulesMock,
  putObjects,
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(),
  detectProjectTypeMock: vi.fn(),
  hasNodeModulesMock: vi.fn(),
  putObjects: [] as Array<{ key: string; body: string }>,
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock("../project/projectType.js", () => ({
  detectProjectType: detectProjectTypeMock,
  hasNodeModules: hasNodeModulesMock,
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send(command: {
      input?: {
        Key?: string;
        Body?: AsyncIterable<Buffer | Uint8Array | string>;
        Prefix?: string;
      };
    }) {
      if (command.input?.Key && command.input?.Body) {
        const chunks: Buffer[] = [];
        for await (const chunk of command.input.Body as AsyncIterable<
          Buffer | Uint8Array | string
        >) {
          chunks.push(
            typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk),
          );
        }
        putObjects.push({
          key: command.input.Key,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      }
      return { Contents: [], IsTruncated: false };
    }
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  ListObjectsV2Command: class {
    constructor(public input: unknown) {}
  },
  DeleteObjectsCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { buildAndUploadPreview } from "./ArtifactSyncService.js";

const ENV_KEYS = [
  "VIVD_S3_BUCKET",
  "R2_BUCKET",
  "VIVD_S3_ENDPOINT_URL",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY",
  "R2_SECRET_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key]);
}

function restoreEnv() {
  for (const [key, value] of originalEnv) {
    if (typeof value === "string") process.env[key] = value;
    else delete process.env[key];
  }
}

function createFailingProcess(stderrText: string): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => void;
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  queueMicrotask(() => {
    proc.stderr.emit("data", Buffer.from(stderrText));
    proc.emit("exit", 1);
  });

  return proc;
}

describe("ArtifactSyncService preview error metadata", () => {
  beforeEach(() => {
    restoreEnv();
    putObjects.length = 0;
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
    detectProjectTypeMock.mockReset();
    hasNodeModulesMock.mockReset();

    process.env.R2_BUCKET = "test-bucket";
    process.env.R2_ENDPOINT = "https://storage.example.test";
    process.env.R2_ACCESS_KEY = "access-key";
    process.env.R2_SECRET_KEY = "secret-key";

    spawnSyncMock.mockReturnValue({
      status: 1,
      error: { code: "ENOENT" },
    });
    detectProjectTypeMock.mockReturnValue({
      framework: "astro",
      packageManager: "npm",
    });
    hasNodeModulesMock.mockReturnValue(false);
    spawnMock.mockImplementation(() =>
      createFailingProcess("npm error code ERESOLVE"),
    );
  });

  afterEach(() => {
    restoreEnv();
  });

  it("persists preview build error metadata when Astro dependency install fails", async () => {
    const tempProject = await fs.mkdtemp(
      path.join(os.tmpdir(), "vivd-preview-error-"),
    );

    await expect(
      buildAndUploadPreview({
        projectDir: tempProject,
        slug: "site-1",
        version: 2,
        commitHash: "abc123",
      }),
    ).rejects.toThrow("npm error code ERESOLVE");

    const previewMetaUpload = putObjects.find(
      (entry) => entry.key === "tenants/default/projects/site-1/v2/preview/.vivd/build.json",
    );

    expect(previewMetaUpload).toBeDefined();
    expect(JSON.parse(previewMetaUpload!.body)).toMatchObject({
      status: "error",
      framework: "astro",
      commitHash: "abc123",
      error: "npm error code ERESOLVE",
    });
  });
});
