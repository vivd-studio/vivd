export const MAX_PROJECT_TAGS = 12;
export const MAX_PROJECT_TAG_LENGTH = 32;

export class ProjectTagsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectTagsValidationError";
  }
}

function normalizeProjectTag(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^#+/, "")
    .trim()
    .toLowerCase();
}

export function normalizeProjectTags(input: string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    const normalized = normalizeProjectTag(value);
    if (!normalized) continue;

    if (normalized.length > MAX_PROJECT_TAG_LENGTH) {
      throw new ProjectTagsValidationError(
        `Tags must be ${MAX_PROJECT_TAG_LENGTH} characters or fewer.`,
      );
    }

    if (seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(normalized);
  }

  if (tags.length > MAX_PROJECT_TAGS) {
    throw new ProjectTagsValidationError(
      `You can assign at most ${MAX_PROJECT_TAGS} tags per project.`,
    );
  }

  return tags;
}
