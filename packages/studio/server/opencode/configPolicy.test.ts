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
    expect(config).toEqual({
      ...STUDIO_OPENCODE_CONFIG_OVERRIDES,
      permission: {
        bash: {
          "*": "allow",
          "vivd publish checklist run*": "ask",
          "vivd publish deploy*": "ask",
          "vivd publish unpublish*": "ask",
          "vivd support request*": "ask",
        },
        doom_loop: "deny",
        external_directory: "deny",
      },
    });
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
        bash: {
          "*": "allow",
          "vivd publish checklist run*": "ask",
          "vivd publish deploy*": "ask",
          "vivd publish unpublish*": "ask",
          "vivd support request*": "ask",
        },
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
        bash: {
          "*": "allow",
          "vivd publish checklist run*": "ask",
          "vivd publish deploy*": "ask",
          "vivd publish unpublish*": "ask",
          "vivd support request*": "ask",
        },
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

    expect(config).toEqual({
      ...STUDIO_OPENCODE_CONFIG_OVERRIDES,
      permission: {
        bash: {
          "*": "allow",
          "vivd publish checklist run*": "ask",
          "vivd publish deploy*": "ask",
          "vivd publish unpublish*": "ask",
          "vivd support request*": "ask",
        },
        doom_loop: "deny",
        external_directory: "deny",
      },
    });
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
        bash: {
          "*": "allow",
          "vivd publish checklist run*": "ask",
          "vivd publish deploy*": "ask",
          "vivd publish unpublish*": "ask",
          "vivd support request*": "ask",
        },
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
          vivd_image_ai: true,
          another_runtime_tool: false,
        },
      }),
    );

    expect(config).toEqual({
      tools: {
        keep_tool: true,
        question: true,
        vivd_image_ai: true,
        another_runtime_tool: false,
      },
      permission: {
        bash: {
          "*": "allow",
          "vivd publish checklist run*": "ask",
          "vivd publish deploy*": "ask",
          "vivd publish unpublish*": "ask",
          "vivd support request*": "ask",
        },
        doom_loop: "deny",
        external_directory: "deny",
      },
    });
  });

  it("preserves a global deny permission policy without weakening bash access", () => {
    const config = JSON.parse(buildStudioOpencodeConfigContent(JSON.stringify({ permission: "deny" })));

    expect(config).toEqual({
      tools: { question: true },
      permission: {
        "*": "deny",
        doom_loop: "deny",
        external_directory: "deny",
      },
    });
  });
});
