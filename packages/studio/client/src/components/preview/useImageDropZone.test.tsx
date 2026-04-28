import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useImageDropZone } from "./useImageDropZone";

vi.mock("@/lib/studioAuth", () => ({
  getVivdStudioToken: () => null,
  withVivdStudioTokenQuery: (url: string) => url,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

type DropZoneApi = ReturnType<typeof useImageDropZone>;

function dispatchDragEvent(
  target: EventTarget,
  type: string,
  assetPath = "src/content/media/shared/hero.webp",
) {
  const dataTransfer = {
    dropEffect: "copy",
    getData: (key: string) =>
      key === "application/x-asset-path" ? assetPath : "",
    types: ["application/x-asset-path"],
  };
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    value: dataTransfer,
  });
  target.dispatchEvent(event);
}

function Harness({
  onReady,
  onImageDropped,
}: {
  onReady: (api: DropZoneApi, iframe: HTMLIFrameElement) => void;
  onImageDropped: ReturnType<typeof vi.fn>;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const api = useImageDropZone({
    iframeRef,
    projectSlug: "demo",
    version: 1,
    enabled: false,
    getDropSupport: () => ({ canDrop: true }),
    onImageDropped,
  });

  useEffect(() => {
    if (iframeRef.current) {
      onReady(api, iframeRef.current);
    }
  }, [api, onReady]);

  return <iframe ref={iframeRef} title="preview" />;
}

describe("useImageDropZone", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("replaces an active drop session instead of stacking image listeners", async () => {
    const onImageDropped = vi.fn();
    let api: DropZoneApi | null = null;
    let iframe: HTMLIFrameElement | null = null;

    render(
      <Harness
        onReady={(nextApi, nextIframe) => {
          api = nextApi;
          iframe = nextIframe;
        }}
        onImageDropped={onImageDropped}
      />,
    );

    await waitFor(() => {
      expect(api).not.toBeNull();
      expect(iframe?.contentDocument).not.toBeNull();
    });

    const doc = iframe!.contentDocument!;
    doc.body.innerHTML = '<img id="hero" src="/old.webp" />';
    const img = doc.getElementById("hero") as HTMLImageElement;

    api!.enableDropZones(doc, "src/content/media/shared/hero.webp");
    api!.enableDropZones(doc, "src/content/media/shared/hero.webp");

    dispatchDragEvent(img, "dragover");
    expect(doc.getElementById("vivd-image-drop-hint")).not.toBeNull();

    dispatchDragEvent(img, "drop");

    await waitFor(() => {
      expect(onImageDropped).toHaveBeenCalledTimes(1);
    });
    expect(doc.getElementById("vivd-image-drop-hint")).toBeNull();
    expect(doc.getElementById("image-drop-zone-styles")).toBeNull();
    expect(img).not.toHaveAttribute("data-drop-target");
  });
});
