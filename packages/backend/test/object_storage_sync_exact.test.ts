import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { syncDirectoryToBucketExact } from "../src/services/storage/ObjectStorageService";

type StoredObject = {
  body: Buffer;
  metadata: Record<string, string>;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readBodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.from("");
  if (typeof body === "string") return Buffer.from(body);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Unsupported body type");
}

class FakeS3 {
  public objects = new Map<string, StoredObject>();

  async send(command: unknown): Promise<unknown> {
    if (command instanceof ListObjectsV2Command) {
      const input = command.input;
      const prefix = (input.Prefix || "").toString();
      const contents = Array.from(this.objects.keys())
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({
          Key: key,
          Size: this.objects.get(key)?.body.length ?? 0,
        }));
      return { Contents: contents, IsTruncated: false };
    }

    if (command instanceof DeleteObjectsCommand) {
      const input = command.input;
      const deleted: Array<{ Key?: string }> = [];
      for (const entry of input.Delete?.Objects ?? []) {
        const key = entry.Key || "";
        if (!key) continue;
        this.objects.delete(key);
        deleted.push({ Key: key });
      }
      return { Deleted: deleted };
    }

    if (command instanceof HeadObjectCommand) {
      const input = command.input;
      const key = (input.Key || "").toString();
      const existing = this.objects.get(key);
      if (!existing) {
        throw new Error(`Missing object: ${key}`);
      }
      return {
        ContentLength: existing.body.length,
        Metadata: existing.metadata,
      };
    }

    if (command instanceof PutObjectCommand) {
      const input = command.input;
      const key = (input.Key || "").toString();
      const body = await readBodyToBuffer(input.Body);
      const metadataEntries = Object.entries(input.Metadata ?? {}).map(([k, v]) => [
        k.toLowerCase(),
        (v || "").toString(),
      ]);
      this.objects.set(key, {
        body,
        metadata: Object.fromEntries(metadataEntries),
      });
      return {};
    }

    throw new Error("Unsupported command");
  }
}

describe("syncDirectoryToBucketExact", () => {
  it("uploads only changed files, deletes stale keys, and keeps unchanged files", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-sync-exact-"));
    const localDir = path.join(tmpDir, "local");
    await fs.mkdir(localDir, { recursive: true });
    await fs.writeFile(path.join(localDir, "a.txt"), "same", "utf-8");
    await fs.writeFile(path.join(localDir, "b.txt"), "new", "utf-8");

    const s3 = new FakeS3();
    s3.objects.set("prefix/a.txt", {
      body: Buffer.from("same"),
      metadata: { "vivd-sha256": sha256("same") },
    });
    s3.objects.set("prefix/old.txt", {
      body: Buffer.from("old"),
      metadata: {},
    });

    const result = await syncDirectoryToBucketExact({
      client: s3 as unknown as S3Client,
      bucket: "bucket",
      localDir,
      keyPrefix: "prefix",
      concurrency: 2,
    });

    expect(result.filesUploaded).toBe(1);
    expect(result.filesDeleted).toBe(1);
    expect(result.filesUnchanged).toBe(1);
    expect(result.errors).toEqual([]);

    expect(s3.objects.has("prefix/old.txt")).toBe(false);
    expect(s3.objects.get("prefix/b.txt")?.body.toString("utf-8")).toBe("new");
    expect(s3.objects.get("prefix/b.txt")?.metadata["vivd-sha256"]).toBe(sha256("new"));

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

