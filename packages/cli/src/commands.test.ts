import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveCliRuntimeMock } = vi.hoisted(() => ({
  resolveCliRuntimeMock: vi.fn(),
}));

vi.mock("./backend.js", () => ({
  resolveCliRuntime: resolveCliRuntimeMock,
}));

vi.mock("@vivd/shared/studio", async () => {
  const actual = await vi.importActual<typeof import("@vivd/shared/studio")>("@vivd/shared/studio");
  return {
    ...actual,
    validateConnectedStudioBackendClientConfig: vi.fn(() => ({
      ok: true,
      missing: [],
    })),
  };
});

import { dispatchCli } from "./commands.js";
import { parseCliArgs, resolveHelpTopic } from "./args.js";

function createRuntimeMock() {
  const query = vi.fn();
  const mutation = vi.fn();
  return {
    config: {
      backendUrl: "https://backend.example.test",
      studioId: "studio_1",
      organizationId: "org_1",
      studioAccessToken: "token_1",
      projectSlug: "demo",
      projectVersion: 7,
    },
    client: {
      query,
      mutation,
    },
    projectSlug: "demo",
    projectVersion: 7,
  };
}

describe("dispatchCli", () => {
  let runtime: ReturnType<typeof createRuntimeMock>;

  beforeEach(() => {
    runtime = createRuntimeMock();
    resolveCliRuntimeMock.mockReset();
    resolveCliRuntimeMock.mockReturnValue(runtime);
  });

  it("shows project info with enabled plugins", async () => {
    runtime.client.query.mockResolvedValue({
      project: {
        slug: "demo",
        title: "Demo site",
        source: "url",
        currentVersion: 7,
        requestedVersion: 7,
      },
      enabledPluginIds: ["contact_form", "analytics"],
    });

    const result = await dispatchCli(["project", "info"]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectInfo", {
      studioId: "studio_1",
      slug: "demo",
      version: 7,
    });
    expect(result.human).toContain("Project: Demo site");
    expect(result.human).toContain("Plugins: contact_form, analytics");
  });

  it("shows the publish checklist with project version context", async () => {
    runtime.client.query.mockResolvedValue({
      checklist: {
        projectSlug: "demo",
        version: 7,
        runAt: "2026-03-29T09:00:00.000Z",
        snapshotCommitHash: "abc123",
        items: [
          { id: "seo", label: "SEO", status: "pass" },
          { id: "a11y", label: "Accessibility", status: "warning", note: "Review contrast" },
        ],
        summary: {
          passed: 1,
          failed: 0,
          warnings: 1,
          skipped: 0,
        },
      },
    });

    const result = await dispatchCli(["publish", "checklist", "show"]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getPublishChecklist", {
      studioId: "studio_1",
      slug: "demo",
      version: 7,
    });
    expect(result.human).toContain("Publish checklist for demo v7");
    expect(result.human).toContain("Summary: 1 passed, 0 failed, 1 warnings, 0 skipped");
    expect(result.human).toContain("- seo | pass | SEO");
    expect(result.human).toContain("- a11y | warning | Accessibility | note: Review contrast");
  });

  it("suggests running the checklist when no saved checklist exists yet", async () => {
    runtime.client.query.mockResolvedValue({
      checklist: null,
    });

    const result = await dispatchCli(["publish", "checklist", "show"]);

    expect(result.human).toContain("Publish checklist: none");
    expect(result.human).toContain("vivd publish checklist run");
    expect(result.human).toContain("only if the user explicitly asked");
  });

  it("runs the publish checklist through the local Studio runtime", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          data: {
            json: {
              success: true,
              sessionId: "sess-checklist",
              checklist: {
                projectSlug: "demo",
                version: 7,
                runAt: "2026-03-29T09:00:00.000Z",
                snapshotCommitHash: "abc123",
                items: [
                  { id: "seo", label: "SEO", status: "pass" },
                ],
                summary: {
                  passed: 1,
                  failed: 0,
                  warnings: 0,
                  skipped: 0,
                },
              },
            },
          },
        },
      }),
    });
    const originalToken = process.env.STUDIO_ACCESS_TOKEN;
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    process.env.STUDIO_ACCESS_TOKEN = "token_1";

    try {
      const result = await dispatchCli(["publish", "checklist", "run"]);

      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3100/vivd-studio/api/trpc/agent.runPrePublishChecklist",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-vivd-studio-token": "token_1",
          }),
          body: JSON.stringify({
            projectSlug: "demo",
            version: 7,
          }),
        }),
      );
      expect(result.human).toContain("Publish checklist run completed.");
      expect(result.human).toContain("Session: sess-checklist");
      expect(result.human).toContain("Publish checklist for demo v7");
    } finally {
      if (originalToken == null) {
        delete process.env.STUDIO_ACCESS_TOKEN;
      } else {
        process.env.STUDIO_ACCESS_TOKEN = originalToken;
      }
      vi.unstubAllGlobals();
    }
  });

  it("updates a publish checklist item with status and note", async () => {
    runtime.client.mutation.mockResolvedValue({
      checklist: {
        projectSlug: "demo",
        version: 7,
        summary: {
          passed: 2,
          failed: 0,
          warnings: 0,
          skipped: 0,
        },
      },
      item: {
        id: "seo",
        label: "SEO",
        status: "pass",
        note: "done",
      },
    });

    const result = await dispatchCli([
      "publish",
      "checklist",
      "update",
      "seo",
      "--status",
      "pass",
      "--note",
      "done",
    ]);

    expect(runtime.client.mutation).toHaveBeenCalledWith("studioApi.updatePublishChecklistItem", {
      studioId: "studio_1",
      slug: "demo",
      version: 7,
      itemId: "seo",
      status: "pass",
      note: "done",
    });
    expect(result.human).toContain("Updated item: seo");
    expect(result.human).toContain("Status: pass");
    expect(result.human).toContain("Note: done");
  });

  it.each(["verify", "resend"] as const)(
    "requests contact recipient verification via %s",
    async (mode) => {
      runtime.client.mutation.mockResolvedValue({
        email: "person@example.com",
        status: "verification_sent",
        cooldownRemainingSeconds: 0,
      });

      const result = await dispatchCli([
        "plugins",
        "contact",
        "recipients",
        mode,
        "person@example.com",
      ]);

      expect(runtime.client.mutation).toHaveBeenCalledWith(
        "studioApi.requestProjectContactRecipientVerification",
        {
          studioId: "studio_1",
          slug: "demo",
          email: "person@example.com",
        },
      );
      expect(result.human).toContain("Recipient: person@example.com");
      expect(result.human).toContain("verification email sent");
      if (mode === "resend") {
        expect(result.human).toContain("Resent recipient verification request.");
      }
    },
  );

  it.each([
    ["plugins", "info", "contact"],
    ["plugins", "contact", "info"],
  ])("shows contact info with recipient and field configuration via %j", async (...argv) => {
    runtime.client.query.mockResolvedValue({
      pluginId: "contact_form",
      entitled: true,
      entitlementState: "enabled",
      enabled: true,
      instanceId: "plugin_1",
      status: "enabled",
      publicToken: "public_1",
      config: {
        recipientEmails: ["owner@example.com"],
        sourceHosts: ["example.com"],
        redirectHostAllowlist: ["example.com"],
        formFields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "message", label: "Message", type: "textarea", required: true },
        ],
      },
      usage: {
        submitEndpoint: "https://api.example.test/plugins/contact",
        expectedFields: ["token", "name", "message"],
        optionalFields: ["_redirect"],
        inferredAutoSourceHosts: ["example.com"],
        turnstileEnabled: false,
        turnstileConfigured: false,
      },
      recipients: {
        options: [
          { email: "owner@example.com", isVerified: true, isPending: false },
          { email: "pending@example.com", isVerified: false, isPending: true },
        ],
        pending: [{ email: "pending@example.com", lastSentAt: "2026-03-29T08:00:00.000Z" }],
      },
      instructions: ["Insert the snippet", "Verify with a test submit"],
    });

    const result = await dispatchCli(argv);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectContactPluginInfo", {
      studioId: "studio_1",
      slug: "demo",
    });
    expect(result.human).toContain("Submit endpoint: https://api.example.test/plugins/contact");
    expect(result.human).toContain("Configured recipients: owner@example.com");
    expect(result.human).toContain("Form fields: name, message");
    expect(result.human).toContain("- owner@example.com [verified]");
    expect(result.human).toContain("- pending@example.com [pending, last sent 2026-03-29T08:00:00.000Z]");
  });

  it("shows the saved contact config", async () => {
    runtime.client.query.mockResolvedValue({
      pluginId: "contact_form",
      entitled: true,
      entitlementState: "enabled",
      enabled: true,
      instanceId: "plugin_1",
      status: "enabled",
      publicToken: "public_1",
      config: {
        recipientEmails: ["team@example.com"],
        sourceHosts: ["example.com"],
        redirectHostAllowlist: ["example.com"],
        formFields: [
          { key: "name", label: "Name", type: "text", required: true, placeholder: "" },
          { key: "message", label: "Message", type: "textarea", required: true, placeholder: "", rows: 5 },
        ],
      },
      usage: {
        submitEndpoint: "https://api.example.test/plugins/contact",
        expectedFields: ["token", "name", "message"],
        optionalFields: ["_redirect"],
        inferredAutoSourceHosts: ["example.com"],
        turnstileEnabled: false,
        turnstileConfigured: false,
      },
      recipients: {
        options: [],
        pending: [],
      },
      instructions: [],
    });

    const result = await dispatchCli(["plugins", "contact", "config", "show"]);

    expect(runtime.client.query).toHaveBeenCalledWith("studioApi.getProjectContactPluginInfo", {
      studioId: "studio_1",
      slug: "demo",
    });
    expect(result.data).toEqual({
      recipientEmails: ["team@example.com"],
      sourceHosts: ["example.com"],
      redirectHostAllowlist: ["example.com"],
      formFields: [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "" },
        { key: "message", label: "Message", type: "textarea", required: true, placeholder: "", rows: 5 },
      ],
    });
    expect(result.human).toContain("Contact config for demo");
    expect(result.human).toContain("\"recipientEmails\": [");
    expect(result.human).toContain("vivd plugins contact config apply --file -");
  });

  it("prints a contact config template", async () => {
    const result = await dispatchCli(["plugins", "contact", "config", "template"]);

    expect(result.data).toEqual({
      recipientEmails: ["team@example.com"],
      sourceHosts: ["example.com"],
      redirectHostAllowlist: ["example.com"],
      formFields: [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "" },
        { key: "email", label: "Email", type: "email", required: true, placeholder: "" },
        {
          key: "message",
          label: "Message",
          type: "textarea",
          required: true,
          placeholder: "",
          rows: 5,
        },
      ],
    });
    expect(result.human).toContain("Contact config template");
    expect(result.human).toContain("\"recipientEmails\": [");
    expect(result.human).toContain("vivd plugins contact config apply --file -");
  });

  it.each([
    ["plugins", "configure", "contact"],
    ["plugins", "contact", "config", "apply"],
  ])("updates contact plugin config from a json file via %j", async (...command) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-cli-"));
    const configPath = path.join(tmpDir, "contact.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        recipientEmails: ["team@example.com"],
        sourceHosts: ["example.com"],
        redirectHostAllowlist: ["example.com"],
        formFields: [
          { key: "name", label: "Name", type: "text", required: true, placeholder: "" },
        ],
      }),
    );
    runtime.client.mutation.mockResolvedValue({ success: true });

    const result = await dispatchCli([...command, "--file", configPath], tmpDir);

    expect(runtime.client.mutation).toHaveBeenCalledWith(
      "studioApi.updateProjectContactPluginConfig",
      {
        studioId: "studio_1",
        slug: "demo",
        config: {
          recipientEmails: ["team@example.com"],
          sourceHosts: ["example.com"],
          redirectHostAllowlist: ["example.com"],
          formFields: [
            { key: "name", label: "Name", type: "text", required: true, placeholder: "" },
          ],
        },
      },
    );
    expect(result.human).toContain("Contact plugin config updated for demo");
    expect(result.human).toContain("vivd plugins contact config show");
  });

  it("updates contact plugin config from stdin when --file - is used", async () => {
    runtime.client.mutation.mockResolvedValue({ success: true });

    const handlers = new Map<string, (chunk?: string) => void>();
    const setEncodingSpy = vi
      .spyOn(process.stdin, "setEncoding")
      .mockImplementation(() => process.stdin);
    const onSpy = vi.spyOn(process.stdin, "on").mockImplementation((event, handler: any) => {
      handlers.set(event, handler);
      return process.stdin;
    });

    try {
      const resultPromise = dispatchCli(["plugins", "contact", "config", "apply", "--file", "-"]);
      handlers.get("data")?.(
        JSON.stringify({
          recipientEmails: ["stdin@example.com"],
          sourceHosts: ["example.com"],
          redirectHostAllowlist: ["example.com"],
          formFields: [
            { key: "email", label: "Email", type: "email", required: true, placeholder: "" },
          ],
        }),
      );
      handlers.get("end")?.();

      const result = await resultPromise;

      expect(setEncodingSpy).toHaveBeenCalledWith("utf8");
      expect(runtime.client.mutation).toHaveBeenCalledWith(
        "studioApi.updateProjectContactPluginConfig",
        {
          studioId: "studio_1",
          slug: "demo",
          config: {
            recipientEmails: ["stdin@example.com"],
            sourceHosts: ["example.com"],
            redirectHostAllowlist: ["example.com"],
            formFields: [
              { key: "email", label: "Email", type: "email", required: true, placeholder: "" },
            ],
          },
        },
      );
      expect(result.human).toContain("Contact plugin config updated for demo");
    } finally {
      onSpy.mockRestore();
      setEncodingSpy.mockRestore();
    }
  });

  it("shows help without CMS commands", async () => {
    const rootHelp = await dispatchCli(["help"]);
    const publishHelp = await dispatchCli(["publish", "help"]);
    const contactHelp = await dispatchCli(["plugins", "contact", "help"]);
    const analyticsHelp = await dispatchCli(["plugins", "analytics", "help"]);

    expect(rootHelp.human).toContain("vivd project info");
    expect(rootHelp.human).not.toContain("vivd cms");
    expect(publishHelp.human).toContain("vivd publish checklist run");
    expect(publishHelp.human).toContain("vivd publish checklist show");
    expect(publishHelp.human).toContain("explicitly asks for a full checklist run");
    expect(publishHelp.human).toContain("inspect or continue checklist items one by one");
    expect(contactHelp.human).toContain("vivd plugins contact info");
    expect(contactHelp.human).toContain("vivd plugins contact config show");
    expect(contactHelp.human).toContain("vivd plugins contact recipients verify <email>");
    expect(analyticsHelp.human).toContain("vivd plugins analytics info");
  });
});

describe("cli args", () => {
  it("parses command and flags", () => {
    const parsed = parseCliArgs([
      "publish",
      "checklist",
      "update",
      "seo",
      "--json",
      "--slug",
      "demo",
      "--version=4",
      "--status",
      "pass",
      "--note=ready to ship",
    ]);

    expect(parsed.tokens).toEqual(["publish", "checklist", "update", "seo"]);
    expect(parsed.flags.json).toBe(true);
    expect(parsed.flags.slug).toBe("demo");
    expect(parsed.flags.version).toBe(4);
    expect(parsed.flags.status).toBe("pass");
    expect(parsed.flags.note).toBe("ready to ship");
  });

  it("allows stdin as a file flag value", () => {
    const parsed = parseCliArgs(["plugins", "contact", "config", "apply", "--file", "-"]);

    expect(parsed.tokens).toEqual(["plugins", "contact", "config", "apply"]);
    expect(parsed.flags.file).toBe("-");
  });

  it("resolves help topics from leading or trailing help tokens", () => {
    expect(resolveHelpTopic(["help", "plugins", "catalog"])).toEqual(["plugins", "catalog"]);
    expect(resolveHelpTopic(["publish", "checklist", "help"])).toEqual(["publish", "checklist"]);
    expect(resolveHelpTopic(["plugins", "contact", "help"])).toEqual(["plugins", "contact"]);
  });
});
