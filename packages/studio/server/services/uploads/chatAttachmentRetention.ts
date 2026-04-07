import fs from "fs-extra";
import path from "node:path";
import {
  STUDIO_CHAT_ATTACHMENT_DIRECTORY,
  STUDIO_CHAT_ATTACHMENT_MAX_FILES,
} from "@studio/shared/chatAttachmentPolicy";

type ChatAttachmentFile = {
  absolutePath: string;
  filename: string;
  sortTimeMs: number;
};

export interface PruneStudioChatAttachmentsResult {
  deletedPaths: string[];
  keptCount: number;
}

export async function pruneStudioChatAttachments(options: {
  projectDir: string;
  maxFiles?: number;
}): Promise<PruneStudioChatAttachmentsResult> {
  const attachmentDir = path.join(
    options.projectDir,
    STUDIO_CHAT_ATTACHMENT_DIRECTORY,
  );
  const maxFiles = Math.max(
    1,
    options.maxFiles ?? STUDIO_CHAT_ATTACHMENT_MAX_FILES,
  );

  if (!(await fs.pathExists(attachmentDir))) {
    return { deletedPaths: [], keptCount: 0 };
  }

  const entries = await fs.readdir(attachmentDir);
  const files = (
    await Promise.all(
      entries.map(async (filename): Promise<ChatAttachmentFile | null> => {
        const absolutePath = path.join(attachmentDir, filename);
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (!stat?.isFile()) return null;

        return {
          absolutePath,
          filename,
          sortTimeMs: Math.max(
            stat.mtimeMs || 0,
            stat.ctimeMs || 0,
            stat.birthtimeMs || 0,
          ),
        };
      }),
    )
  ).filter((entry): entry is ChatAttachmentFile => entry !== null);

  if (files.length <= maxFiles) {
    return { deletedPaths: [], keptCount: files.length };
  }

  files.sort(
    (left, right) =>
      right.sortTimeMs - left.sortTimeMs ||
      right.filename.localeCompare(left.filename),
  );

  const staleFiles = files.slice(maxFiles);
  await Promise.all(staleFiles.map((file) => fs.remove(file.absolutePath)));

  return {
    deletedPaths: staleFiles.map((file) =>
      path.posix.join(STUDIO_CHAT_ATTACHMENT_DIRECTORY, file.filename),
    ),
    keptCount: maxFiles,
  };
}
