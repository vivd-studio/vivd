import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyStudioOpencodeConfigPolicy,
  buildStudioOpencodeConfigContent,
  STUDIO_OPENCODE_CONFIG_OVERRIDES,
} from "./configPolicy.js";

describe("OpenCode config policy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enforces question tool enablement and restricted permissions by default", () => {
    const config = JSON.parse(buildStudioOpencodeConfigContent(undefined));
    expect(config).toEqual(STUDIO_OPENCODE_CONFIG_OVERRIDES);
  });

  it("preserves existing config and merges policy settings", () => {
    const config = JSON.parse(
      buildStudioOpencodeConfigContent(
        JSON.stringify({
          plugin: [{ source: "demo-plugin" }],
          tools: { imagen_generate: true },
          permission: { bash: "ask" },
        }),
      ),
    );

    expect(config).toEqual({
      plugin: [{ source: "demo-plugin" }],
      tools: {
        imagen_generate: true,
        question: true,
      },
      permission: {
        bash: "ask",
        doom_loop: "deny",
        external_directory: "deny",
      },
    });
  });

  it("keeps question enabled even if incoming config tries to disable it", () => {
    const config = JSON.parse(
      buildStudioOpencodeConfigContent(JSON.stringify({ tools: { question: false } })),
    );

    expect(config).toEqual({
      tools: { question: true },
      permission: {
        doom_loop: "deny",
        external_directory: "deny",
      },
    });
  });

  it("overrides restricted permission fields from incoming config", () => {
    const config = JSON.parse(
      buildStudioOpencodeConfigContent(
        JSON.stringify({
          permission: {
            doom_loop: "allow",
            external_directory: "allow",
            webfetch: "ask",
          },
        }),
      ),
    );

    expect(config).toEqual({
      permission: {
        doom_loop: "deny",
        external_directory: "deny",
        webfetch: "ask",
      },
      tools: { question: true },
    });
  });

  it("falls back to generated config when OPENCODE_CONFIG_CONTENT is invalid JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = JSON.parse(buildStudioOpencodeConfigContent("{"));

    expect(config).toEqual(STUDIO_OPENCODE_CONFIG_OVERRIDES);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      "Failed to parse OPENCODE_CONFIG_CONTENT",
    );
  });

  it("applies nested overrides without dropping unrelated keys", () => {
    const merged = applyStudioOpencodeConfigPolicy({
      tools: { another_tool: true },
      command: { publish: false },
      permission: { websearch: "ask" },
    });

    expect(merged).toEqual({
      tools: {
        another_tool: true,
        question: true,
      },
      command: { publish: false },
      permission: {
        websearch: "ask",
        doom_loop: "deny",
        external_directory: "deny",
      },
    });
  });

  it("merges runtime tool enablement overrides", () => {
    const config = JSON.parse(
      buildStudioOpencodeConfigContent(JSON.stringify({ tools: { keep_tool: true } }), {
        toolEnablement: {
          vivd_plugins_catalog: true,
          vivd_plugins_contact_info: false,
        },
      }),
    );

    expect(config).toEqual({
      tools: {
        keep_tool: true,
        question: true,
        vivd_plugins_catalog: true,
        vivd_plugins_contact_info: false,
      },
      permission: {
        doom_loop: "deny",
        external_directory: "deny",
      },
    });
  });
});
