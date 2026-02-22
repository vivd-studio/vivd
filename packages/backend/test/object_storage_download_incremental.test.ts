import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { downloadBucketPrefixToDirectoryIncremental } from "../src/services/storage/ObjectStorageService";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

class FakeS3 {
  public objects = new Map<string, Buffer>();

  async send(command: unknown): Promise<unknown> {
    if (command instanceof ListObjectsV2Command) {
      const input = command.input;
      const prefix = (input.Prefix || "").toString();
      const contents = Array.from(this.objects.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, body]) => ({
          Key: key,
          Size: body.length,
        }));
      return { Contents: contents, IsTruncated: false };
    }

    if (command instanceof GetObjectCommand) {
      const input = command.input;
      const key = (input.Key || "").toString();
      const body = this.objects.get(key);
      if (!body) {
        throw new Error(`Missing object: ${key}`);
      }
      return {
        Body: body,
        ContentLength: body.length,
      };
    }

    throw new Error("Unsupported command");
  }
}

describe("downloadBucketPrefixToDirectoryIncremental", () => {
  it("skips unchanged files via manifest and removes local stale files", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-download-incremental-"));
    const localDir = path.join(tmpDir, "local");
    await fs.mkdir(localDir, { recursive: true });

    await fs.writeFile(path.join(localDir, "a.txt"), "same", "utf-8");
    await fs.writeFile(path.join(localDir, "stale.txt"), "remove-me", "utf-8");

    const manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      files: [
        { relPath: "a.txt", size: 4, sha256: sha256("same") },
        { relPath: "b.txt", size: 3, sha256: sha256("new") },
      ],
    };

    const s3 = new FakeS3();
    s3.objects.set("prefix/a.txt", Buffer.from("same"));
    s3.objects.set("prefix/b.txt", Buffer.from("new"));
    s3.objects.set(
      "prefix/.vivd-sync-manifest.json",
      Buffer.from(`${JSON.stringify(manifest)}\n`, "utf-8"),
    );

    const result = await downloadBucketPrefixToDirectoryIncremental({
      client: s3 as unknown as S3Client,
      bucket: "bucket",
      keyPrefix: "prefix",
      localDir,
      concurrency: 2,
    });

    expect(result.filesSkipped).toBe(1);
    expect(result.filesDownloaded).toBe(1);
    expect(result.filesDeleted).toBe(1);
    expect(result.errors).toEqual([]);

    expect(await fs.readFile(path.join(localDir, "a.txt"), "utf-8")).toBe("same");
    expect(await fs.readFile(path.join(localDir, "b.txt"), "utf-8")).toBe("new");
    await expect(fs.access(path.join(localDir, "stale.txt"))).rejects.toBeTruthy();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

