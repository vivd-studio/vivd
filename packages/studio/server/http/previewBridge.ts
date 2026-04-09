import { buildPreviewBridgeScript } from "@studio/shared/previewBridge";

const PREVIEW_BRIDGE_SCRIPT_SRC = "/vivd-studio/api/preview-bridge.js";
const PREVIEW_BRIDGE_SCRIPT_PATTERN =
  /<script\b[^>]*\bsrc=["'][^"']*preview-bridge\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/i;

function resolvePreviewBridgeScriptSrc(runtimeBasePath?: string | null): string {
  const normalizedBasePath = runtimeBasePath?.trim().replace(/\/+$/, "") || "";
  if (!normalizedBasePath || normalizedBasePath === "/") {
    return PREVIEW_BRIDGE_SCRIPT_SRC;
  }

  return `${normalizedBasePath}${PREVIEW_BRIDGE_SCRIPT_SRC}`;
}

function createBridgeScriptTag(runtimeBasePath?: string | null): string {
  return `<script src="${resolvePreviewBridgeScriptSrc(runtimeBasePath)}"></script>`;
}

export function createPreviewBridgeScript(): string {
  return buildPreviewBridgeScript();
}

export function injectPreviewBridgeScript(
  html: string,
  runtimeBasePath?: string | null,
): string {
  if (PREVIEW_BRIDGE_SCRIPT_PATTERN.test(html)) {
    return html;
  }

  const script = createBridgeScriptTag(runtimeBasePath);
  const headMatch = html.match(/<head(\s[^>]*)?>|<head>/i);
  if (headMatch && headMatch.index !== undefined) {
    const insertPos = headMatch.index + headMatch[0].length;
    return html.slice(0, insertPos) + script + html.slice(insertPos);
  }

  const doctypeMatch = html.match(/<!DOCTYPE[^>]*>/i);
  if (doctypeMatch && doctypeMatch.index !== undefined) {
    const insertPos = doctypeMatch.index + doctypeMatch[0].length;
    return html.slice(0, insertPos) + script + html.slice(insertPos);
  }

  return script + html;
}
