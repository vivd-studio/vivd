import { buildPreviewBridgeScript } from "@studio/shared/previewBridge";

const PREVIEW_BRIDGE_SCRIPT_SRC = "/vivd-studio/api/preview-bridge.js";

function createBridgeScriptTag(): string {
  return `<script src="${PREVIEW_BRIDGE_SCRIPT_SRC}"></script>`;
}

export function createPreviewBridgeScript(): string {
  return buildPreviewBridgeScript();
}

export function injectPreviewBridgeScript(html: string): string {
  const script = createBridgeScriptTag();
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
