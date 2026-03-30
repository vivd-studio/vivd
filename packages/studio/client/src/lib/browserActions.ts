export async function copyTextWithFallback(text: string): Promise<void> {
  let clipboardError: unknown = null;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  if (!document.body) {
    throw clipboardError instanceof Error
      ? clipboardError
      : new Error("Clipboard is unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).cloneRange()
      : null;
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied =
    typeof document.execCommand === "function" &&
    document.execCommand("copy");

  textarea.remove();

  if (selection) {
    selection.removeAllRanges();
    if (previousRange) {
      selection.addRange(previousRange);
    }
  }
  activeElement?.focus();

  if (!copied) {
    throw clipboardError instanceof Error
      ? clipboardError
      : new Error("Failed to copy text");
  }
}

export function openUrlInNewTab(url: string): void {
  if (!document.body) {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.assign(url);
    }
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();
}
