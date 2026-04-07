export const STUDIO_CHAT_ATTACHMENT_DIRECTORY = ".vivd/dropped-images";
export const STUDIO_CHAT_ATTACHMENT_MAX_FILES = 10;

export function normalizeStudioChatAttachmentPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function isStudioChatAttachmentDirectory(input: string): boolean {
  return (
    normalizeStudioChatAttachmentPath(input) === STUDIO_CHAT_ATTACHMENT_DIRECTORY
  );
}
