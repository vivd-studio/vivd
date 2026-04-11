export interface RenderVivdCliRootHelpInput {
  previewScreenshotEnabled?: boolean;
}

type HelpEntry = {
  command: string;
  description: string;
};

function formatHelpEntries(entries: HelpEntry[]): string[] {
  const width = entries.reduce((max, entry) => Math.max(max, entry.command.length), 0);
  return entries.map((entry) => `  ${entry.command.padEnd(width)}  ${entry.description}`);
}

function formatHelpSection(title: string, entries: HelpEntry[]): string[] {
  return [title, ...formatHelpEntries(entries)];
}

function formatHelpListSection(title: string, lines: string[]): string[] {
  return [title, ...lines.map((line) => `  ${line}`)];
}

export function renderVivdCliRootHelp(
  input: RenderVivdCliRootHelpInput = {},
): string {
  const previewEntries: HelpEntry[] = [
    {
      command: "vivd preview status",
      description: "Show runtime health, preview mode, browser URL, and dev server state",
    },
    {
      command: "vivd preview logs [path]",
      description: "Capture browser console output for a preview path such as / or /pricing",
    },
    {
      command: "vivd preview help",
      description: "Show preview-specific flags and debugging guidance",
    },
  ];

  if (input.previewScreenshotEnabled) {
    previewEntries.splice(2, 0, {
      command: "vivd preview screenshot [path]",
      description: "Capture a preview screenshot (experimental; saved under .vivd/dropped-images/ by default)",
    });
  }

  return [
    "Work with the connected Vivd project, preview runtime, plugins, local CMS workspace, and publish workflow.",
    "",
    "USAGE",
    "  vivd <command> <subcommand> [flags]",
    "",
    ...formatHelpSection("CONNECTION & CONTEXT", [
      {
        command: "vivd doctor",
        description: "Check backend connectivity, auth env, and current Studio/project context",
      },
      {
        command: "vivd whoami",
        description: "Show the connected Studio, project slug, and project version",
      },
      {
        command: "vivd project info",
        description: "Show project metadata and enabled plugins",
      },
    ]),
    "",
    ...formatHelpSection("PREVIEW & DEBUGGING", previewEntries),
    "",
    ...formatHelpSection("PLUGINS", [
      {
        command: "vivd plugins catalog",
        description: "List available and enabled plugins for the current project",
      },
      {
        command: "vivd plugins info <pluginId>",
        description: "Show plugin state, usage hints, and supported capabilities",
      },
      {
        command: "vivd plugins config show <pluginId>",
        description: "Print the current plugin config",
      },
      {
        command: "vivd plugins config apply <pluginId> --file <json>",
        description: "Update a plugin config from JSON",
      },
      {
        command: "vivd plugins action <pluginId> <actionId> [args...]",
        description: "Run a plugin action",
      },
      {
        command: "vivd plugins help",
        description: "Show plugin-specific help and discovery hints",
      },
    ]),
    "",
    ...formatHelpSection("LOCAL CMS", [
      {
        command: "vivd cms status",
        description: "Inspect the local Astro content collections and src/content/ asset state",
      },
      {
        command: "vivd cms validate",
        description: "Validate Astro content collections and entry files without a connected runtime",
      },
      {
        command: "vivd cms scaffold init",
        description: "Legacy YAML CMS only: create the baseline local CMS structure",
      },
      {
        command: "vivd cms scaffold model <key>",
        description: "Legacy YAML CMS only: create a starter schema/model file",
      },
      {
        command: "vivd cms scaffold entry <model-key> <entry-key>",
        description: "Legacy YAML CMS only: create a starter content entry file",
      },
      {
        command: "vivd cms help",
        description: "Show CMS-specific guidance and constraints",
      },
    ]),
    "",
    ...formatHelpSection("PUBLISH CHECKLIST", [
      {
        command: "vivd publish checklist show",
        description: "Inspect the current checklist state",
      },
      {
        command: "vivd publish checklist update <item-id> --status <status>",
        description: "Update one checklist item",
      },
      {
        command: "vivd publish checklist run",
        description: "Start a full checklist pass when explicitly requested",
      },
      {
        command: "vivd publish help",
        description: "Show checklist workflow details",
      },
    ]),
    "",
    ...formatHelpSection("SUPPORT", [
      {
        command: "vivd support request <summary...>",
        description:
          "Draft a support email with project context; only use after the user explicitly approves contacting support",
      },
      {
        command: "vivd support help",
        description: "Show support-contact guidance and consent requirements",
      },
    ]),
    "",
    ...formatHelpSection("GLOBAL FLAGS", [
      {
        command: "--help",
        description: "Show help for the current command",
      },
      {
        command: "--json",
        description: "Print machine-readable JSON instead of the human summary",
      },
      {
        command: "--slug <project-slug>",
        description: "Override VIVD_PROJECT_SLUG for project-scoped commands",
      },
      {
        command: "--version <project-version>",
        description: "Override VIVD_PROJECT_VERSION for project-scoped commands",
      },
    ]),
    "",
    ...formatHelpListSection("EXAMPLES", [
      "$ vivd doctor",
      "$ vivd preview status",
      "$ vivd plugins catalog",
      "$ vivd publish checklist show",
      "$ vivd support request enable analytics for this project",
    ]),
    "",
    ...formatHelpListSection("DISCOVER MORE", [
      "Use `vivd <command> help` for command-specific flags, examples, and subcommands.",
      "Start with `vivd plugins catalog` to discover plugin IDs, then `vivd plugins info <pluginId>`.",
      "If support intervention is needed, use `vivd support request ...` only after the user explicitly approves contacting support on their behalf.",
      "Connected commands need MAIN_BACKEND_URL, STUDIO_ID, and STUDIO_ACCESS_TOKEN.",
    ]),
  ].join("\n");
}
