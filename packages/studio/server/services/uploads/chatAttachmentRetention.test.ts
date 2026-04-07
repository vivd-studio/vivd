import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STUDIO_CHAT_ATTACHMENT_DIRECTORY } from "@studio/shared/chatAttachmentPolicy";
import { pruneStudioChatAttachments } from "./chatAttachmentRetention.js";

const tempDirs: string[] = [];

describe("pruneStudioChatAttachments", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.remove(dir)));
  });

  it("keeps only the newest files in the chat attachment folder", async () => {
    const projectDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "vivd-chat-attachments-"),
    );
    tempDirs.push(projectDir);

    const attachmentDir = path.join(projectDir, STUDIO_CHAT_ATTACHMENT_DIRECTORY);
    await fs.ensureDir(attachmentDir);

    for (let index = 0; index < 12; index += 1) {
      const filePath = path.join(attachmentDir, `ref-${index}.txt`);
      await fs.writeFile(filePath, `file-${index}`);
      const timestamp = new Date(Date.UTC(2026, 3, 7, 10, 0, index));
      await fs.utimes(filePath, timestamp, timestamp);
    }

    const result = await pruneStudioChatAttachments({ projectDir });
    const remainingFiles = (await fs.readdir(attachmentDir)).sort();

    expect(result.deletedPaths).toHaveLength(2);
    expect(remainingFiles).toHaveLength(10);
    expect(remainingFiles).not.toContain("ref-0.txt");
    expect(remainingFiles).not.toContain("ref-1.txt");
    expect(remainingFiles).toContain("ref-11.txt");
  });
});
