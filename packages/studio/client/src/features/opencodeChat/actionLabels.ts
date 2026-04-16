import type { OpenCodePermissionRequest } from "./types";

export type ToolStatus = "running" | "completed" | "error";
export type ToolActivityLabelParts = { action: string; target?: string };

export interface ResolvedPermissionRequestDisplay {
  title: string;
  summary: string;
  technicalPermission: string;
  technicalPatterns: string[];
  showTechnicalDetails: boolean;
}

interface ResolvedCommandAction {
  displayTitle: string;
  displaySummary?: string;
  running: ToolActivityLabelParts;
  completed: ToolActivityLabelParts;
  error: ToolActivityLabelParts;
}

type CommandActionDefinition = {
  matches: (tokens: string[]) => boolean;
  resolve: (tokens: string[]) => ResolvedCommandAction;
};

const TOOL_TARGET_INPUT_KEYS = [
  "path",
  "filePath",
  "filepath",
  "file_path",
  "filename",
  "file",
  "fileName",
  "name",
  "target_file",
  "target",
  "targetPath",
  "target_path",
  "source",
  "sourcePath",
  "source_path",
  "sourceFile",
  "source_file",
] as const;

function createTargetedToolLabelBuilder({
  runningAction,
  completedAction,
  errorAction,
  fallbackTarget,
  runningFallbackTarget = fallbackTarget,
  includeErrorTarget = true,
}: {
  runningAction: string;
  completedAction: string;
  errorAction: string;
  fallbackTarget: string;
  runningFallbackTarget?: string | null;
  includeErrorTarget?: boolean;
}) {
  return ({
    status,
    target,
  }: {
    status: ToolStatus;
    target?: string;
  }): ToolActivityLabelParts => {
    if (status === "running") {
      const runningTarget = target ?? runningFallbackTarget;
      if (!runningTarget) return { action: runningAction };
      return { action: runningAction, target: `${runningTarget}...` };
    }
    if (status === "error") {
      if (!includeErrorTarget) return { action: errorAction };
      return { action: errorAction, target: target ?? fallbackTarget };
    }
    return { action: completedAction, target: target ?? fallbackTarget };
  };
}

function createActionOnlyToolLabelBuilder({
  runningAction,
  completedAction,
  errorAction,
}: {
  runningAction: string;
  completedAction: string;
  errorAction: string;
}) {
  return ({ status }: { status: ToolStatus }): ToolActivityLabelParts => {
    if (status === "running") return { action: `${runningAction}...` };
    if (status === "error") return { action: errorAction };
    return { action: completedAction };
  };
}

const GENERIC_TOOL_LABEL_BUILDERS = {
  read: createTargetedToolLabelBuilder({
    runningAction: "Reading",
    completedAction: "Read",
    errorAction: "Failed reading",
    fallbackTarget: "file",
  }),
  grep: createTargetedToolLabelBuilder({
    runningAction: "Exploring",
    completedAction: "Explored",
    errorAction: "Failed exploring",
    fallbackTarget: "files",
  }),
  edit: createTargetedToolLabelBuilder({
    runningAction: "Editing",
    completedAction: "Edited",
    errorAction: "Failed editing",
    fallbackTarget: "file",
  }),
  write: createTargetedToolLabelBuilder({
    runningAction: "Editing",
    completedAction: "Edited",
    errorAction: "Failed editing",
    fallbackTarget: "file",
    runningFallbackTarget: null,
  }),
  glob: createTargetedToolLabelBuilder({
    runningAction: "Exploring",
    completedAction: "Explored",
    errorAction: "Failed exploring",
    fallbackTarget: "files",
  }),
  vivd_image_ai: createActionOnlyToolLabelBuilder({
    runningAction: "Generating image (this can take a while)",
    completedAction: "Generated image",
    errorAction: "Failed generating image",
  }),
} satisfies Record<
  string,
  (input: { status: ToolStatus; target?: string }) => ToolActivityLabelParts
>;

const COMMAND_ACTION_DEFINITIONS: CommandActionDefinition[] = [
  {
    matches: (tokens) => matchesCommandPath(tokens, ["vivd", "publish", "deploy"]),
    resolve: (tokens) => {
      const domain = findFlagValue(tokens, ["--domain"]);
      const environment = findFlagValue(tokens, ["--environment", "--env"]);

      if (domain) {
        return {
          displayTitle: `Deploy to ${domain}`,
          displaySummary: `Publish the current version to ${domain}.`,
          running: { action: "Deploying", target: `to ${domain}...` },
          completed: { action: "Deployed", target: `to ${domain}` },
          error: { action: "Deployment failed" },
        };
      }

      if (environment) {
        return {
          displayTitle: `Deploy to ${environment}`,
          displaySummary: `Publish the current version to the ${environment} environment.`,
          running: { action: "Deploying", target: `to ${environment}...` },
          completed: { action: "Deployed", target: `to ${environment}` },
          error: { action: "Deployment failed" },
        };
      }

      return {
        displayTitle: "Deploy the site",
        displaySummary: "Publish the current version.",
        running: { action: "Deploying the site..." },
        completed: { action: "Deployed the site" },
        error: { action: "Deployment failed" },
      };
    },
  },
  {
    matches: (tokens) => matchesCommandPath(tokens, ["vivd", "publish", "unpublish"]),
    resolve: (tokens) => {
      const domain = findFlagValue(tokens, ["--domain"]);

      if (domain) {
        return {
          displayTitle: `Unpublish ${domain}`,
          displaySummary: `Remove ${domain} from public access.`,
          running: { action: "Unpublishing", target: `${domain}...` },
          completed: { action: "Unpublished", target: domain },
          error: { action: "Unpublish failed" },
        };
      }

      return {
        displayTitle: "Unpublish the site",
        displaySummary: "Remove the current site from public access.",
        running: { action: "Unpublishing the site..." },
        completed: { action: "Unpublished the site" },
        error: { action: "Unpublish failed" },
      };
    },
  },
  {
    matches: (tokens) =>
      matchesCommandPath(tokens, ["vivd", "publish", "checklist", "run"]),
    resolve: () => ({
      displayTitle: "Check publish readiness",
      displaySummary: "Run the full publish checklist.",
      running: { action: "Checking", target: "publish readiness..." },
      completed: { action: "Checked", target: "publish readiness" },
      error: { action: "Publish check failed" },
    }),
  },
  {
    matches: (tokens) => matchesCommandPath(tokens, ["vivd", "support", "contact"]),
    resolve: () => ({
      displayTitle: "Contact Vivd support",
      displaySummary: "Prepare the support request for delivery.",
      running: { action: "Preparing", target: "support request..." },
      completed: { action: "Prepared", target: "support request" },
      error: { action: "Support request failed" },
    }),
  },
];

export function resolvePermissionRequestDisplay(
  request: OpenCodePermissionRequest,
): ResolvedPermissionRequestDisplay {
  const metadataTitle = readMetadataText(request.metadata, "displayTitle");
  const metadataSummary = readMetadataText(request.metadata, "displaySummary");
  const metadataDescription = readMetadataText(request.metadata, "description");
  const technicalPatterns = request.patterns.filter(
    (pattern): pattern is string =>
      typeof pattern === "string" && pattern.trim().length > 0,
  );

  if (metadataTitle) {
    return {
      title: metadataTitle,
      summary:
        metadataSummary ??
        "Approve or reject this action to let the run continue.",
      technicalPermission: request.permission,
      technicalPatterns,
      showTechnicalDetails:
        technicalPatterns.length > 0 || request.permission.trim().length > 0,
    };
  }

  if (request.permission === "bash") {
    const resolvedCommand = resolveKnownCommandAction(technicalPatterns[0]);
    if (resolvedCommand) {
      return {
        title: resolvedCommand.displayTitle,
        summary:
          metadataSummary ??
          resolvedCommand.displaySummary ??
          "Approve or reject this action to let the run continue.",
        technicalPermission: request.permission,
        technicalPatterns,
        showTechnicalDetails: true,
      };
    }

    if (metadataDescription) {
      return {
        title: metadataDescription,
        summary:
          metadataSummary ??
          "Approve or reject this technical task to let the run continue.",
        technicalPermission: request.permission,
        technicalPatterns,
        showTechnicalDetails: true,
      };
    }
  }

  return {
    title: request.permission === "bash" ? "Run a technical task" : "Approve requested access",
    summary:
      metadataSummary ??
      "Approve or reject this action to let the run continue.",
    technicalPermission: request.permission,
    technicalPatterns,
    showTechnicalDetails:
      technicalPatterns.length > 0 || request.permission.trim().length > 0,
  };
}

export function resolveToolActivityLabelParts(input: {
  toolName: string;
  status: ToolStatus;
  toolInput?: unknown;
}): ToolActivityLabelParts {
  const normalizedToolName = input.toolName.trim().toLowerCase();

  if (normalizedToolName === "bash") {
    const command = extractCommandText(input.toolInput);
    const resolvedCommand = resolveKnownCommandAction(command);
    if (resolvedCommand) {
      if (input.status === "running") return resolvedCommand.running;
      if (input.status === "error") return resolvedCommand.error;
      return resolvedCommand.completed;
    }

    if (input.status === "running") {
      return { action: "Running", target: "technical task..." };
    }
    if (input.status === "error") {
      return { action: "Technical task failed" };
    }
    return { action: "Completed", target: "technical task" };
  }

  const builder = GENERIC_TOOL_LABEL_BUILDERS[
    normalizedToolName as keyof typeof GENERIC_TOOL_LABEL_BUILDERS
  ];
  if (builder) {
    return builder({
      status: input.status,
      target: extractToolTargetName(input.toolInput),
    });
  }

  if (input.status === "running") return { action: "Running", target: "tool..." };
  if (input.status === "error") return { action: "Tool failed" };
  return { action: "Completed", target: "tool action" };
}

function readMetadataText(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveKnownCommandAction(
  command: string | undefined,
): ResolvedCommandAction | null {
  const tokens = tokenizeShellCommand(command);
  if (tokens.length === 0) return null;

  for (const definition of COMMAND_ACTION_DEFINITIONS) {
    if (definition.matches(tokens)) {
      return definition.resolve(tokens);
    }
  }

  return null;
}

function tokenizeShellCommand(command: string | undefined): string[] {
  if (!command) return [];

  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of command.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function matchesCommandPath(tokens: string[], expectedPath: string[]): boolean {
  return expectedPath.every((segment, index) => tokens[index] === segment);
}

function findFlagValue(tokens: string[], flags: string[]): string | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    for (const flag of flags) {
      if (token === flag) {
        const next = tokens[index + 1];
        if (next && !next.startsWith("-")) {
          return next;
        }
        return undefined;
      }
      if (token.startsWith(`${flag}=`)) {
        return token.slice(flag.length + 1) || undefined;
      }
    }
  }
  return undefined;
}

function extractCommandText(input: unknown): string | undefined {
  const obj = parseObjectInput(input);
  if (obj && typeof obj.command === "string") {
    const normalized = obj.command.trim();
    return normalized || undefined;
  }

  if (typeof input === "string") {
    const normalized = input.trim();
    return normalized || undefined;
  }

  return undefined;
}

function extractToolTargetName(input: unknown): string | undefined {
  if (typeof input === "string") {
    return pathToFilename(input);
  }

  const obj = parseObjectInput(input);
  if (!obj) return undefined;

  for (const key of TOOL_TARGET_INPUT_KEYS) {
    const value = obj[key];
    if (typeof value !== "string") continue;
    const filename = pathToFilename(value);
    if (filename) return filename;
  }

  return undefined;
}

function parseObjectInput(input: unknown): Record<string, unknown> | null {
  if (!input) return null;

  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid JSON.
  }

  return null;
}

function pathToFilename(pathLike: string): string | undefined {
  const trimmed = pathLike.trim();
  if (!trimmed) return undefined;

  const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
  const segments = withoutQuery.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || undefined;
}
