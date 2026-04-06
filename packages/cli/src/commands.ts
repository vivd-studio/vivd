import fs from "node:fs/promises";
import path from "node:path";
import { validateConnectedStudioBackendClientConfig } from "@vivd/shared/studio";
import { parseCliArgs, resolveHelpTopic, isHelpRequested, type CliFlags } from "./args.js";
import { resolveCliRuntime } from "./backend.js";
import {
  formatAnalyticsPluginReport,
  formatContactConfigReport,
  formatContactConfigTemplateReport,
  formatContactConfigUpdateReport,
  formatContactPluginReport,
  formatContactRecipientVerificationReport,
  formatDoctorReport,
  formatPluginCatalogReport,
  formatProjectInfoReport,
  formatPublishChecklistReport,
  formatPublishChecklistUpdateReport,
  formatWhoamiReport,
} from "./format.js";

type CommandResult = {
  data: unknown;
  human: string;
  exitCode?: number;
};

type ProjectInfoResponse = {
  project: {
    slug: string;
    title: string;
    source: "url" | "scratch";
    currentVersion: number;
    requestedVersion: number;
  };
  enabledPluginIds: string[];
};

type ChecklistStatus = "pass" | "fail" | "warning" | "skip" | "fixed";

type PublishChecklistItem = {
  id: string;
  label: string;
  status: ChecklistStatus;
  note?: string | null;
};

type PublishChecklist = {
  projectSlug: string;
  version: number;
  runAt: string;
  snapshotCommitHash?: string | null;
  items: PublishChecklistItem[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
    fixed?: number;
  };
};

type PublishChecklistQueryResponse = {
  checklist: PublishChecklist | null;
};

type PublishChecklistUpdateResponse = {
  checklist: PublishChecklist;
  item: PublishChecklistItem;
};

type PluginCatalogResponse = {
  project: { organizationId: string; slug: string };
  available: Array<{ pluginId: string; name?: string; description?: string }>;
  instances: Array<{ pluginId: string; status: string; instanceId: string }>;
};

type ContactInfoResponse = {
  pluginId: "contact_form";
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: {
    recipientEmails?: string[];
    sourceHosts?: string[];
    redirectHostAllowlist?: string[];
    formFields?: Array<{
      key: string;
      label?: string;
      type?: string;
      required?: boolean;
      placeholder?: string;
      rows?: number;
    }>;
  } | null;
  usage: {
    submitEndpoint: string;
    expectedFields: string[];
    optionalFields: string[];
    inferredAutoSourceHosts: string[];
    turnstileEnabled: boolean;
    turnstileConfigured: boolean;
  };
  recipients: {
    options: Array<{
      email: string;
      isVerified: boolean;
      isPending: boolean;
    }>;
    pending: Array<{
      email: string;
      lastSentAt: string | null;
    }>;
  };
  instructions: string[];
};

type AnalyticsInfoResponse = {
  pluginId: "analytics";
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  usage: {
    scriptEndpoint: string;
    trackEndpoint: string;
    eventTypes: string[];
    respectDoNotTrack: boolean;
    captureQueryString: boolean;
    enableClientTracking: boolean;
  };
  instructions: string[];
};

const CONTACT_CONFIG_TEMPLATE = {
  recipientEmails: ["team@example.com"],
  sourceHosts: ["example.com"],
  redirectHostAllowlist: ["example.com"],
  formFields: [
    {
      key: "name",
      label: "Name",
      type: "text",
      required: true,
      placeholder: "",
    },
    {
      key: "email",
      label: "Email",
      type: "email",
      required: true,
      placeholder: "",
    },
    {
      key: "message",
      label: "Message",
      type: "textarea",
      required: true,
      placeholder: "",
      rows: 5,
    },
  ],
};

const GENERAL_HELP: Record<string, string> = {
  root: [
    "vivd help",
    "vivd doctor",
    "vivd whoami",
    "vivd project info",
    "vivd plugins help",
    "vivd publish help",
  ].join("\n"),
  plugins: [
    "vivd plugins catalog",
    "vivd plugins contact info",
    "vivd plugins contact config show",
    "vivd plugins contact config template",
    "vivd plugins contact config apply --file config.json",
    "vivd plugins contact recipients verify <email>",
    "vivd plugins contact recipients resend <email>",
    "vivd plugins analytics info",
  ].join("\n"),
  contact: [
    "vivd plugins contact info",
    "vivd plugins contact config show",
    "vivd plugins contact config template",
    "vivd plugins contact config apply --file config.json",
    "vivd plugins contact recipients verify <email>",
    "vivd plugins contact recipients resend <email>",
    "Use --file - to read JSON config from stdin.",
    "Contact info shows submit endpoint, configured recipients, verification state, and install guidance.",
  ].join("\n"),
  analytics: [
    "vivd plugins analytics info",
    "Analytics info shows the script endpoint, public token, and integration guidance.",
  ].join("\n"),
  publish: [
    "vivd publish checklist show",
    "vivd publish checklist update <item-id> --status <status> [--note ...]",
    "Allowed statuses: pass, fail, warning, skip, fixed",
    "Use --slug and --version (or VIVD_PROJECT_SLUG / VIVD_PROJECT_VERSION).",
  ].join("\n"),
};

function jsonResult(data: unknown, human: string, exitCode?: number): CommandResult {
  return { data, human, exitCode };
}

function ensureConnectedRuntime(
  flags: Pick<CliFlags, "slug" | "version">,
): ReturnType<typeof resolveCliRuntime> {
  return resolveCliRuntime(process.env, flags);
}

function requireProjectSlug(runtime: ReturnType<typeof resolveCliRuntime>): string {
  if (!runtime?.projectSlug) {
    throw new Error("This command requires a project slug. Set VIVD_PROJECT_SLUG or pass --slug.");
  }
  return runtime.projectSlug;
}

function requireProjectVersion(runtime: ReturnType<typeof resolveCliRuntime>): number {
  if (!runtime?.projectVersion) {
    throw new Error(
      "This command requires a project version. Set VIVD_PROJECT_VERSION or pass --version.",
    );
  }
  return runtime.projectVersion;
}

function resolveInputPath(inputPath: string, cwd: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.join(cwd, inputPath);
}

async function readJsonFile(value: string): Promise<unknown> {
  if (value === "-") {
    return new Promise((resolve, reject) => {
      let raw = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        raw += chunk;
      });
      process.stdin.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
      process.stdin.on("error", reject);
    });
  }

  return fs.readFile(value, "utf8").then((text) => JSON.parse(text));
}

function isChecklistStatus(value: string | undefined): value is ChecklistStatus {
  return (
    value === "pass" ||
    value === "fail" ||
    value === "warning" ||
    value === "skip" ||
    value === "fixed"
  );
}

async function withRuntime<T>(
  flags: Pick<CliFlags, "slug" | "version">,
  fn: (runtime: NonNullable<ReturnType<typeof resolveCliRuntime>>) => Promise<T>,
): Promise<T> {
  const runtime = ensureConnectedRuntime(flags);
  if (!runtime) {
    throw new Error(
      "Vivd CLI is not connected. Set MAIN_BACKEND_URL, STUDIO_ID, and STUDIO_ACCESS_TOKEN.",
    );
  }
  return fn(runtime);
}

function helpTextFor(topic: string[]): string {
  const normalized = topic.join(" ").trim();
  if (!normalized || normalized === "root") {
    return GENERAL_HELP.root;
  }
  if (
    normalized.startsWith("plugins contact") ||
    normalized.startsWith("plugins info contact")
  ) {
    return GENERAL_HELP.contact;
  }
  if (
    normalized.startsWith("plugins analytics") ||
    normalized.startsWith("plugins info analytics")
  ) {
    return GENERAL_HELP.analytics;
  }
  if (normalized.startsWith("plugins")) {
    return GENERAL_HELP.plugins;
  }
  if (normalized.startsWith("publish")) {
    return GENERAL_HELP.publish;
  }
  return GENERAL_HELP.root;
}

async function runDoctor(flags: CliFlags): Promise<CommandResult> {
  const runtime = ensureConnectedRuntime(flags);
  const validation = validateConnectedStudioBackendClientConfig(runtime?.config);
  const connected = Boolean(runtime);
  let backendCheckOk = false;
  let backendCheckError: string | null = null;

  if (runtime) {
    try {
      await runtime.client.query("studioApi.getStatus", {
        studioId: runtime.config.studioId,
      });
      backendCheckOk = true;
    } catch (error) {
      backendCheckError = error instanceof Error ? error.message : String(error);
    }
  }

  return jsonResult(
    {
      connected,
      studioId: runtime?.config.studioId ?? null,
      projectSlug: runtime?.projectSlug ?? null,
      projectVersion: runtime?.projectVersion ?? null,
      validation,
      backendCheck: {
        ok: backendCheckOk,
        error: backendCheckError,
      },
    },
    formatDoctorReport({
      connected,
      studioId: runtime?.config.studioId ?? null,
      projectSlug: runtime?.projectSlug ?? null,
      projectVersion: runtime?.projectVersion ?? null,
      missing: validation.missing,
      backendCheckOk,
      backendCheckError,
    }),
    validation.ok && backendCheckOk ? 0 : 1,
  );
}

async function runWhoami(flags: CliFlags): Promise<CommandResult> {
  const runtime = ensureConnectedRuntime(flags);
  const connected = Boolean(runtime);

  return jsonResult(
    {
      connected,
      studioId: runtime?.config.studioId ?? null,
      projectSlug: runtime?.projectSlug ?? null,
      projectVersion: runtime?.projectVersion ?? null,
    },
    formatWhoamiReport({
      connected,
      studioId: runtime?.config.studioId ?? null,
      projectSlug: runtime?.projectSlug ?? null,
      projectVersion: runtime?.projectVersion ?? null,
    }),
  );
}

async function runProjectInfo(flags: CliFlags): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const info = (await runtime.client.query("studioApi.getProjectInfo", {
      studioId: runtime.config.studioId,
      slug,
      version: runtime.projectVersion ?? undefined,
    })) as ProjectInfoResponse;

    return jsonResult(info, formatProjectInfoReport(info));
  });
}

async function runPluginsCatalog(flags: CliFlags): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const catalog = (await runtime.client.query("studioApi.getProjectPluginsCatalog", {
      studioId: runtime.config.studioId,
      slug,
      version: runtime.projectVersion ?? undefined,
    })) as PluginCatalogResponse;
    return jsonResult(catalog, formatPluginCatalogReport(catalog));
  });
}

async function runPluginsInfo(
  kind: "contact" | "analytics",
  flags: CliFlags,
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);

    if (kind === "contact") {
      const info = (await runtime.client.query("studioApi.getProjectContactPluginInfo", {
        studioId: runtime.config.studioId,
        slug,
      })) as ContactInfoResponse;
      return jsonResult(info, formatContactPluginReport(info));
    }

    const info = (await runtime.client.query("studioApi.getProjectAnalyticsPluginInfo", {
      studioId: runtime.config.studioId,
      slug,
    })) as AnalyticsInfoResponse;
    return jsonResult(info, formatAnalyticsPluginReport(info));
  });
}

async function runContactRecipientVerification(
  mode: "verify" | "resend",
  flags: CliFlags,
  email: string,
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const result = (await runtime.client.mutation(
      "studioApi.requestProjectContactRecipientVerification",
      {
        studioId: runtime.config.studioId,
        slug,
        email,
      },
    )) as {
      email: string;
      status:
        | "already_verified"
        | "added_verified"
        | "verification_sent"
        | "verification_pending";
      cooldownRemainingSeconds: number;
    };

    const prefix =
      mode === "resend"
        ? "Resent recipient verification request."
        : "Recipient verification requested.";

    return jsonResult(
      result,
      [prefix, formatContactRecipientVerificationReport(result)].join("\n"),
    );
  });
}

async function runPluginsConfigureContact(
  flags: CliFlags,
  cwd: string,
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const filePath = flags.file?.trim();
    if (!filePath) {
      throw new Error("contact config apply requires --file <config.json|->");
    }

    const config = await readJsonFile(filePath === "-" ? "-" : resolveInputPath(filePath, cwd));
    const result = await runtime.client.mutation("studioApi.updateProjectContactPluginConfig", {
      studioId: runtime.config.studioId,
      slug,
      config,
    });

    return jsonResult(result, formatContactConfigUpdateReport(slug));
  });
}

async function runContactConfigShow(flags: CliFlags): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const info = (await runtime.client.query("studioApi.getProjectContactPluginInfo", {
      studioId: runtime.config.studioId,
      slug,
    })) as ContactInfoResponse;

    return jsonResult(
      info.config,
      formatContactConfigReport({
        projectSlug: slug,
        config: info.config,
        enabled: info.enabled,
        entitled: info.entitled,
      }),
    );
  });
}

async function runContactConfigTemplate(): Promise<CommandResult> {
  return jsonResult(
    CONTACT_CONFIG_TEMPLATE,
    formatContactConfigTemplateReport(CONTACT_CONFIG_TEMPLATE),
  );
}

async function runPublishChecklistShow(flags: CliFlags): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const version = requireProjectVersion(runtime);
    const result = (await runtime.client.query("studioApi.getPublishChecklist", {
      studioId: runtime.config.studioId,
      slug,
      version,
    })) as PublishChecklistQueryResponse;

    return jsonResult(result, formatPublishChecklistReport(result));
  });
}

async function runPublishChecklistUpdate(
  flags: CliFlags,
  itemId: string,
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const version = requireProjectVersion(runtime);
    const status = flags.status?.trim().toLowerCase();
    if (!isChecklistStatus(status)) {
      throw new Error(
        "publish checklist update requires --status <pass|fail|warning|skip|fixed>",
      );
    }

    const result = (await runtime.client.mutation(
      "studioApi.updatePublishChecklistItem",
      {
        studioId: runtime.config.studioId,
        slug,
        version,
        itemId,
        status,
        note: flags.note ?? undefined,
      },
    )) as PublishChecklistUpdateResponse;

    return jsonResult(result, formatPublishChecklistUpdateReport(result));
  });
}

async function runHelp(flags: CliFlags, tokens: string[]): Promise<CommandResult> {
  const topic = resolveHelpTopic(tokens);
  const normalized = topic.join(" ").trim() || "root";
  const help = helpTextFor(topic);
  return jsonResult({ topic: normalized, help }, help);
}

export async function dispatchCli(
  argv: string[],
  cwd: string = process.cwd(),
): Promise<CommandResult> {
  const parsed = parseCliArgs(argv);
  if (parsed.unknownFlags.length > 0) {
    throw new Error(`Unknown flag(s): ${parsed.unknownFlags.join(", ")}`);
  }

  const tokens = parsed.tokens;
  if (isHelpRequested(tokens, parsed.flags)) {
    return runHelp(parsed.flags, tokens);
  }

  const [head, second, third, ...rest] = tokens;

  switch (head) {
    case undefined:
    case "help":
      return runHelp(parsed.flags, tokens);
    case "doctor":
      return runDoctor(parsed.flags);
    case "whoami":
      return runWhoami(parsed.flags);
    case "project":
      if (second !== "info") {
        throw new Error("Unknown project command. Try `vivd project info`.");
      }
      return runProjectInfo(parsed.flags);
    case "plugins":
      if (second === "catalog") {
        return runPluginsCatalog(parsed.flags);
      }
      if (second === "contact" && third === "info") {
        return runPluginsInfo("contact", parsed.flags);
      }
      if (second === "info" && third === "contact") {
        return runPluginsInfo("contact", parsed.flags);
      }
      if (second === "analytics" && third === "info") {
        return runPluginsInfo("analytics", parsed.flags);
      }
      if (second === "info" && third === "analytics") {
        return runPluginsInfo("analytics", parsed.flags);
      }
      if (second === "contact" && third === "config" && rest[0] === "show") {
        return runContactConfigShow(parsed.flags);
      }
      if (second === "contact" && third === "config" && rest[0] === "template") {
        return runContactConfigTemplate();
      }
      if (second === "contact" && third === "config" && rest[0] === "apply") {
        return runPluginsConfigureContact(parsed.flags, cwd);
      }
      if (second === "contact" && third === "recipients" && rest[0] === "verify" && rest[1]) {
        return runContactRecipientVerification("verify", parsed.flags, rest[1]);
      }
      if (second === "contact" && third === "recipients" && rest[0] === "resend" && rest[1]) {
        return runContactRecipientVerification("resend", parsed.flags, rest[1]);
      }
      if (second === "configure" && third === "contact") {
        return runPluginsConfigureContact(parsed.flags, cwd);
      }
      throw new Error("Unknown plugins command. Try `vivd plugins help`.");
    case "publish":
      if (second === "checklist" && third === "show") {
        return runPublishChecklistShow(parsed.flags);
      }
      if (second === "checklist" && third === "update" && rest[0]) {
        return runPublishChecklistUpdate(parsed.flags, rest[0]);
      }
      throw new Error("Unknown publish command. Try `vivd publish help`.");
    default:
      throw new Error(`Unknown command: ${head}. Try \`vivd help\`.`);
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const result = await dispatchCli(argv);
    if (parseCliArgs(argv).flags.json) {
      console.log(JSON.stringify(result.data, null, 2));
    } else {
      console.log(result.human);
    }
    return result.exitCode ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}
