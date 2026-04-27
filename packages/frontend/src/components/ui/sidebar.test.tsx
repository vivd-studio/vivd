import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "./sidebar";

const SIDEBAR_STORAGE_KEY = "sidebar_state";
const SIDEBAR_IMMERSIVE_HIDE_DELAY_MS = 260;

function TestSidebar({
  defaultOpen = true,
}: {
  defaultOpen?: boolean;
}) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar collapsible="icon">
        <div>Navigation</div>
      </Sidebar>
      <SidebarTrigger />
    </SidebarProvider>
  );
}

function TestImmersiveSidebar({
  defaultOpen = false,
  immersiveKey = "project-alpha",
}: {
  defaultOpen?: boolean;
  immersiveKey?: string;
}) {
  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      desktopMode="immersive"
      immersiveKey={immersiveKey}
    >
      <Sidebar collapsible="icon">
        <div>Navigation</div>
      </Sidebar>
      <SidebarTrigger appearance="brand" />
    </SidebarProvider>
  );
}

function TestImmersiveSidebarWithHeaderTrigger() {
  return (
    <SidebarProvider
      defaultOpen={false}
      desktopMode="immersive"
      immersiveKey="project-alpha"
    >
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex w-full items-center justify-center">
            <SidebarTrigger appearance="brand" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div data-testid="sidebar-body">Navigation</div>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

function TestImmersivePassiveBrandTrigger() {
  return (
    <SidebarProvider
      defaultOpen={false}
      desktopMode="immersive"
      immersiveKey="project-alpha"
    >
      <Sidebar collapsible="icon">
        <div>Navigation</div>
      </Sidebar>
      <SidebarTrigger appearance="brand" revealOnHover={false} />
    </SidebarProvider>
  );
}

function TestSidebarTooltip() {
  return (
    <SidebarProvider defaultOpen={false}>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Organizations">Org</SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarProvider>
  );
}

function getSidebarRoot() {
  return document.querySelector("[data-state][data-overlay-state]") as HTMLElement;
}

function getSidebarGap() {
  return document.querySelector('[data-sidebar="gap"]') as HTMLElement;
}

describe("SidebarProvider persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "sidebar_state=; path=/; max-age=0";

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores the desktop sidebar state from localStorage on mount", () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "false");

    render(<TestSidebar />);

    expect(getSidebarRoot()).toHaveAttribute("data-state", "collapsed");
  });

  it("persists the updated sidebar state and restores it after remount", () => {
    const { unmount } = render(<TestSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("false");
    expect(document.cookie).toContain("sidebar_state=false");

    unmount();
    render(<TestSidebar />);

    expect(getSidebarRoot()).toHaveAttribute("data-state", "collapsed");
  });

  it("closes collapsed sidebar tooltips when the pointer leaves the trigger", async () => {
    render(<TestSidebarTooltip />);

    const trigger = screen.getByRole("button", { name: "Org" });

    fireEvent.pointerMove(trigger);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Organizations");

    fireEvent.pointerLeave(trigger);
    fireEvent.pointerMove(tooltip);

    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("shows a tooltip on the sidebar trigger", async () => {
    render(<TestSidebar />);

    fireEvent.pointerMove(screen.getByRole("button", { name: "Toggle Sidebar" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Toggle sidebar");
  });

  it("uses the persisted desktop sidebar state in immersive mode", () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "true");

    const { unmount } = render(<TestImmersiveSidebar defaultOpen={false} />);

    expect(getSidebarRoot()).toHaveAttribute("data-state", "expanded");
    expect(getSidebarRoot()).toHaveAttribute("data-overlay-state", "open");
    expect(getSidebarGap().className).toContain("w-[var(--sidebar-width)]");
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");

    unmount();
    render(<TestSidebar />);

    expect(getSidebarRoot()).toHaveAttribute("data-state", "expanded");
  });

  it("supports the brand-style sidebar trigger appearance", () => {
    render(<TestImmersiveSidebar />);

    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });

    expect(trigger).toHaveAttribute("data-sidebar-trigger-appearance", "brand");
    expect(
      trigger.querySelector('[data-sidebar-brand-glyph="brand"]'),
    ).toBeInTheDocument();
    expect(
      trigger.querySelector('[data-sidebar-brand-glyph="panel"]'),
    ).toBeInTheDocument();
  });

  it("uses distinct open and close glyphs for the sidebar trigger state", () => {
    render(<TestSidebar />);

    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    const openGlyph = trigger.querySelector('[data-sidebar-panel-glyph="open"]');
    const closeGlyph = trigger.querySelector('[data-sidebar-panel-glyph="close"]');

    expect(openGlyph).toHaveClass("rotate-90", "opacity-0");
    expect(closeGlyph).toHaveClass("rotate-0", "opacity-100");
    expect(
      trigger.querySelector('[data-sidebar-panel-action="close"]'),
    ).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(openGlyph).toHaveClass("rotate-0", "opacity-100");
    expect(closeGlyph).toHaveClass("-rotate-90", "opacity-0");
    expect(
      trigger.querySelector('[data-sidebar-panel-action="open"]'),
    ).toBeInTheDocument();
  });

  it("starts hidden in immersive mode when the shared sidebar preference is collapsed", () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "false");

    render(<TestImmersiveSidebar defaultOpen={true} />);

    expect(getSidebarRoot()).toHaveAttribute("data-state", "collapsed");
    expect(getSidebarRoot()).toHaveAttribute("data-overlay-state", "hidden");
    expect(getSidebarGap().className).toContain("w-0");
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("false");
  });

  it("does not reveal the immersive sidebar when hover-reveal is disabled on the trigger", () => {
    render(<TestImmersivePassiveBrandTrigger />);

    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });

    fireEvent.pointerEnter(trigger);

    expect(getSidebarRoot()).toHaveAttribute("data-overlay-state", "hidden");
  });

  it("reveals the collapsed rail on hover and hides it after a short delay", () => {
    vi.useFakeTimers();
    render(<TestImmersiveSidebar />);

    const hotspot = document.querySelector('[data-sidebar="hotspot"]') as HTMLElement;
    const sidebarRoot = getSidebarRoot();

    fireEvent.pointerEnter(hotspot);
    expect(sidebarRoot).toHaveAttribute("data-overlay-state", "peek");

    fireEvent.pointerLeave(hotspot);
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_IMMERSIVE_HIDE_DELAY_MS - 1);
    });
    expect(sidebarRoot).toHaveAttribute("data-overlay-state", "peek");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(sidebarRoot).toHaveAttribute("data-overlay-state", "hidden");
  });

  it("reveals the collapsed rail when the pointer moves near the left edge", () => {
    render(<TestImmersiveSidebar />);

    expect(getSidebarRoot()).toHaveAttribute("data-overlay-state", "hidden");

    fireEvent.pointerMove(window, { clientX: 11, pointerType: "mouse" });

    expect(getSidebarRoot()).toHaveAttribute("data-overlay-state", "peek");
  });

  it("keeps the rail visible while moving from the hover hotspot into the sidebar", () => {
    vi.useFakeTimers();
    render(<TestImmersiveSidebar />);

    const hotspot = document.querySelector('[data-sidebar="hotspot"]') as HTMLElement;
    const sidebarRoot = getSidebarRoot();
    const sidebarPanel = document.querySelector('[data-sidebar="sidebar"]') as HTMLElement;

    fireEvent.pointerEnter(hotspot);
    expect(sidebarRoot).toHaveAttribute("data-overlay-state", "peek");

    fireEvent.pointerLeave(hotspot);
    fireEvent.pointerEnter(sidebarPanel);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(sidebarRoot).toHaveAttribute("data-overlay-state", "peek");
  });

  it("keeps the rail visible while moving from the sidebar brand trigger into the sidebar body", () => {
    vi.useFakeTimers();
    render(<TestImmersiveSidebarWithHeaderTrigger />);

    const sidebarRoot = getSidebarRoot();
    const sidebarBody = screen.getByTestId("sidebar-body");
    const sidebarTrigger = document.querySelector(
      '[data-sidebar="header"] [data-sidebar="trigger"]',
    ) as HTMLElement;

    fireEvent.pointerEnter(sidebarTrigger);
    expect(sidebarRoot).toHaveAttribute("data-overlay-state", "peek");

    fireEvent.pointerLeave(sidebarTrigger, { relatedTarget: sidebarBody });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(sidebarRoot).toHaveAttribute("data-overlay-state", "peek");
  });

  it("uses the existing trigger to persist immersive open and collapsed state across routes", () => {
    const immersiveRender = render(<TestImmersiveSidebar defaultOpen={false} />);

    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    const sidebarRoot = getSidebarRoot();
    const sidebarGap = getSidebarGap();

    fireEvent.focus(trigger);
    expect(sidebarRoot).toHaveAttribute("data-overlay-state", "peek");

    fireEvent.click(trigger);
    expect(sidebarRoot).toHaveAttribute("data-state", "expanded");
    expect(sidebarRoot).toHaveAttribute("data-overlay-state", "open");
    expect(sidebarGap.className).toContain("w-[var(--sidebar-width)]");
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");

    immersiveRender.unmount();
    const defaultRender = render(<TestSidebar defaultOpen={false} />);

    expect(getSidebarRoot()).toHaveAttribute("data-state", "expanded");

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("false");

    defaultRender.unmount();
    render(<TestImmersiveSidebar defaultOpen={true} />);

    expect(getSidebarRoot()).toHaveAttribute("data-state", "collapsed");
    expect(getSidebarRoot()).toHaveAttribute("data-overlay-state", "hidden");
    expect(getSidebarGap().className).toContain("w-0");
  });
});
