import { describe, expect, it } from "vitest";

import {
  injectPreviewBridgeScript,
  createPreviewBridgeScript,
} from "./previewBridge";

describe("createPreviewBridgeScript", () => {
  it("emits the stable preview bridge contract", () => {
    const script = createPreviewBridgeScript();

    expect(script).toContain("vivd-preview-bridge");
    expect(script).toContain("var parentOrigin = window.location.origin;");
    expect(script).toContain("vivd:preview:ready");
    expect(script).toContain("vivd:preview:navigation-start");
    expect(script).toContain("vivd:preview:location-change");
    expect(script).toContain("vivd:preview:navigation-complete");
    expect(script).toContain("vivd:preview:runtime-error");
    expect(script).toContain("__vivdPreviewBridgeInstalled");
  });
});

describe("injectPreviewBridgeScript", () => {
  it("injects the bridge script into the head when present", () => {
    const html = "<!doctype html><html><head><title>Test</title></head><body></body></html>";

    const injected = injectPreviewBridgeScript(html);

    expect(injected).toContain(
      '<script src="/vivd-studio/api/preview-bridge.js"></script>',
    );
    expect(injected.indexOf('<script src="/vivd-studio/api/preview-bridge.js"></script>')).toBeLessThan(
      injected.indexOf("<title>Test</title>"),
    );
  });

  it("prepends the bridge script when no head is present", () => {
    const html = "<!doctype html><html><body>Test</body></html>";

    const injected = injectPreviewBridgeScript(html);

    expect(injected).toContain(
      '<script src="/vivd-studio/api/preview-bridge.js"></script>',
    );
    expect(injected.startsWith("<!doctype html><script src=\"/vivd-studio/api/preview-bridge.js\"></script>")).toBe(
      true,
    );
  });
});
