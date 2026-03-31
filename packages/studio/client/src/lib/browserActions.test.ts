import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextWithFallback, openUrlInNewTab } from "./browserActions";

describe("browserActions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("uses the clipboard API when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const execCommand = vi.fn();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await copyTextWithFallback("https://preview.example.com/site-1");

    expect(writeText).toHaveBeenCalledWith(
      "https://preview.example.com/site-1",
    );
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to execCommand copy when the clipboard API fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    await copyTextWithFallback("https://preview.example.com/site-2");

    expect(writeText).toHaveBeenCalledWith(
      "https://preview.example.com/site-2",
    );
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.activeElement).toBe(button);
  });

  it("opens a URL by clicking a temporary anchor", () => {
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    openUrlInNewTab("https://preview.example.com/site-3");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);

    const link = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement;
    expect(link.href).toBe("https://preview.example.com/site-3");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(document.body.childElementCount).toBe(0);
  });
});
