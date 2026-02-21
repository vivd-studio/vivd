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

  it("enforces question tool disablement by default", () => {
    const config = JSON.parse(buildStudioOpencodeConfigContent(undefined));
    expect(config).toEqual(STUDIO_OPENCODE_CONFIG_OVERRIDES);
  });

  it("preserves existing config and merges tool settings", () => {
    const config = JSON.parse(
      buildStudioOpencodeConfigContent(
        JSON.stringify({
          plugin: [{ source: "demo-plugin" }],
          tools: { imagen_generate: true },
        }),
      ),
    );

    expect(config).toEqual({
      plugin: [{ source: "demo-plugin" }],
      tools: {
        imagen_generate: true,
        question: false,
      },
    });
  });

  it("overrides question=true from incoming config", () => {
    const config = JSON.parse(
      buildStudioOpencodeConfigContent(JSON.stringify({ tools: { question: true } })),
    );

    expect(config).toEqual({
      tools: { question: false },
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
    });

    expect(merged).toEqual({
      tools: {
        another_tool: true,
        question: false,
      },
      command: { publish: false },
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
        question: false,
        vivd_plugins_catalog: true,
        vivd_plugins_contact_info: false,
      },
    });
  });
});
