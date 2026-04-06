export interface CliFlags {
  json: boolean;
  help: boolean;
  slug?: string;
  version?: number;
  file?: string;
  status?: string;
  note?: string;
}

export interface ParsedCliArgs {
  tokens: string[];
  flags: CliFlags;
  unknownFlags: string[];
}

function takeNextValue(
  argv: string[],
  index: number,
  flagName: string,
  options?: { allowLeadingDash?: boolean },
): string {
  const next = argv[index + 1];
  const allowLeadingDash = options?.allowLeadingDash ?? false;
  if (!next || (!allowLeadingDash && next.startsWith("-"))) {
    throw new Error(`Missing value for ${flagName}`);
  }
  return next;
}

function readInlineValue(token: string): string | null {
  const separatorIndex = token.indexOf("=");
  if (separatorIndex < 0) return null;
  return token.slice(separatorIndex + 1);
}

function parseNumber(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid value for ${flagName}: ${value}`);
  }
  return parsed;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const tokens: string[] = [];
  const unknownFlags: string[] = [];
  const flags: CliFlags = {
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--json" || token === "-j") {
      flags.json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      flags.help = true;
      continue;
    }

    if (token === "--slug" || token === "--project-slug") {
      flags.slug = takeNextValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--slug=") || token.startsWith("--project-slug=")) {
      flags.slug = readInlineValue(token) || undefined;
      continue;
    }

    if (token === "--version" || token === "--project-version") {
      flags.version = parseNumber(takeNextValue(argv, index, token), token);
      index += 1;
      continue;
    }
    if (token.startsWith("--version=") || token.startsWith("--project-version=")) {
      flags.version = parseNumber(readInlineValue(token) || "", token);
      continue;
    }

    if (token === "--file" || token === "-f") {
      flags.file = takeNextValue(argv, index, token, { allowLeadingDash: true });
      index += 1;
      continue;
    }
    if (token.startsWith("--file=")) {
      flags.file = readInlineValue(token) || undefined;
      continue;
    }

    if (token === "--status") {
      flags.status = takeNextValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--status=")) {
      flags.status = readInlineValue(token) || undefined;
      continue;
    }

    if (token === "--note") {
      flags.note = takeNextValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token.startsWith("--note=")) {
      flags.note = readInlineValue(token) || undefined;
      continue;
    }

    if (token.startsWith("-")) {
      unknownFlags.push(token);
      continue;
    }

    tokens.push(token);
  }

  return { tokens, flags, unknownFlags };
}

export function isHelpRequested(tokens: string[], flags: CliFlags): boolean {
  return flags.help || tokens.length === 0 || tokens[0] === "help" || tokens.at(-1) === "help";
}

export function resolveHelpTopic(tokens: string[]): string[] {
  if (tokens[0] === "help") {
    return tokens.slice(1);
  }
  if (tokens.at(-1) === "help") {
    return tokens.slice(0, -1);
  }
  return tokens;
}
