import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  useParamsMock,
  useLocationMock,
  useNavigateMock,
  useUtilsMock,
  projectListUseQueryMock,
  projectStatusUseQueryMock,
  startStudioUseMutationMock,
  hardRestartStudioUseMutationMock,
  touchStudioUseMutationMock,
  getStudioUrlUseQueryMock,
  externalPreviewUseQueryMock,
  regenerateThumbnailUseMutationMock,
  setPublicPreviewEnabledUseMutationMock,
  deleteProjectUseMutationMock,
  renameSlugUseMutationMock,
  getMyMembershipUseQueryMock,
  useSessionMock,
  useThemeMock,
  useSidebarMock,
  useStudioRuntimeGuardMock,
  resolveStudioRuntimeUrlMock,
} = vi.hoisted(() => ({
  useParamsMock: vi.fn(),
  useLocationMock: vi.fn(),
  useNavigateMock: vi.fn(),
  useUtilsMock: vi.fn(),
  projectListUseQueryMock: vi.fn(),
  projectStatusUseQueryMock: vi.fn(),
  startStudioUseMutationMock: vi.fn(),
  hardRestartStudioUseMutationMock: vi.fn(),
  touchStudioUseMutationMock: vi.fn(),
  getStudioUrlUseQueryMock: vi.fn(),
  externalPreviewUseQueryMock: vi.fn(),
  regenerateThumbnailUseMutationMock: vi.fn(),
  setPublicPreviewEnabledUseMutationMock: vi.fn(),
  deleteProjectUseMutationMock: vi.fn(),
  renameSlugUseMutationMock: vi.fn(),
  getMyMembershipUseQueryMock: vi.fn(),
  useSessionMock: vi.fn(),
  useThemeMock: vi.fn(),
  useSidebarMock: vi.fn(),
  useStudioRuntimeGuardMock: vi.fn(),
  resolveStudioRuntimeUrlMock: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useParams: useParamsMock,
    useLocation: useLocationMock,
    useNavigate: useNavigateMock,
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    project: {
      list: { useQuery: projectListUseQueryMock },
      status: { useQuery: projectStatusUseQueryMock },
      startStudio: { useMutation: startStudioUseMutationMock },
      hardRestartStudio: { useMutation: hardRestartStudioUseMutationMock },
      touchStudio: { useMutation: touchStudioUseMutationMock },
      getStudioUrl: { useQuery: getStudioUrlUseQueryMock },
      getExternalPreviewStatus: { useQuery: externalPreviewUseQueryMock },
      regenerateThumbnail: { useMutation: regenerateThumbnailUseMutationMock },
      setPublicPreviewEnabled: { useMutation: setPublicPreviewEnabledUseMutationMock },
      delete: { useMutation: deleteProjectUseMutationMock },
      renameSlug: { useMutation: renameSlugUseMutationMock },
    },
    organization: {
      getMyMembership: { useQuery: getMyMembershipUseQueryMock },
    },
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: useSessionMock,
  },
}));

vi.mock("@/components/theme", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
  useTheme: useThemeMock,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: ({
    appearance,
    revealOnHover,
  }: {
    appearance?: "panel" | "brand";
    revealOnHover?: boolean;
  }) => (
    <button
      type="button"
      aria-label="Toggle Sidebar"
      data-appearance={appearance ?? "panel"}
      data-reveal-on-hover={revealOnHover === false ? "false" : "true"}
    >
      Sidebar
    </button>
  ),
  useSidebar: useSidebarMock,
}));

vi.mock("@/components/shell", () => ({
  HeaderProfileMenu: () => <div data-testid="profile-menu" />,
  HostHeader: ({
    leadingAccessory,
    leading,
    trailing,
  }: {
    leadingAccessory?: ReactNode;
    leading?: ReactNode;
    trailing?: ReactNode;
  }) => (
    <div data-testid="host-header">
      {leadingAccessory}
      {leading}
      {trailing}
    </div>
  ),
  HeaderBreadcrumbTextLink: ({
    children,
  }: {
    children?: ReactNode;
  }) => <>{children}</>,
}));

vi.mock("@/components/projects/publish/PublishSiteDialog", () => ({
  PublishSiteDialog: () => <div data-testid="publish-dialog" />,
}));

vi.mock("@/components/common/StudioStartupLoading", () => ({
  StudioStartupLoading: ({
    header,
  }: {
    header?: ReactNode;
  }) => (
    <div data-testid="studio-startup-loading">
      {header}
    </div>
  ),
}));

vi.mock("@/hooks/useStudioRuntimeGuard", () => ({
  useStudioRuntimeGuard: useStudioRuntimeGuardMock,
}));

vi.mock("@/lib/studioRuntimeUrl", () => ({
  resolveStudioRuntimeUrl: resolveStudioRuntimeUrlMock,
}));

vi.mock("@/lib/brand", () => ({
  formatDocumentTitle: vi.fn((title?: string) => (title ? `${title} - Vivd` : "Vivd")),
}));

import EmbeddedStudio from "./EmbeddedStudio";
import { MemoryRouter } from "react-router-dom";

function makeProject(slug = "site-1") {
  return {
    slug,
    status: "completed",
    currentVersion: 1,
    publicPreviewEnabled: true,
    versions: [{ version: 1, status: "completed" }],
    thumbnailUrl: null,
  };
}

function renderEmbeddedStudio() {
  return render(
    <MemoryRouter>
      <EmbeddedStudio />
    </MemoryRouter>,
  );
}

function expectNoPreviewSurfaceControls() {
  expect(
    screen.queryByRole("button", { name: "Live Preview" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Publish Preview" }),
  ).not.toBeInTheDocument();
}

describe("EmbeddedStudio", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    window.sessionStorage.clear();
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    useParamsMock.mockReset();
    useLocationMock.mockReset();
    useNavigateMock.mockReset();
    useUtilsMock.mockReset();
    projectListUseQueryMock.mockReset();
    projectStatusUseQueryMock.mockReset();
    startStudioUseMutationMock.mockReset();
    hardRestartStudioUseMutationMock.mockReset();
    touchStudioUseMutationMock.mockReset();
    getStudioUrlUseQueryMock.mockReset();
    externalPreviewUseQueryMock.mockReset();
    regenerateThumbnailUseMutationMock.mockReset();
    setPublicPreviewEnabledUseMutationMock.mockReset();
    deleteProjectUseMutationMock.mockReset();
    renameSlugUseMutationMock.mockReset();
    getMyMembershipUseQueryMock.mockReset();
    useSessionMock.mockReset();
    useThemeMock.mockReset();
    useSidebarMock.mockReset();
    useStudioRuntimeGuardMock.mockReset();
    resolveStudioRuntimeUrlMock.mockReset();

    useParamsMock.mockReturnValue({ projectSlug: "site-1" });
    useLocationMock.mockReturnValue({ search: "" });
    useNavigateMock.mockReturnValue(vi.fn());

    const invalidateMock = vi.fn().mockResolvedValue(undefined);
    useUtilsMock.mockReturnValue({
      project: {
        getStudioUrl: { invalidate: invalidateMock },
        list: { invalidate: invalidateMock },
      },
    });

    startStudioUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      data: null,
      error: null,
      reset: vi.fn(),
    });
    hardRestartStudioUseMutationMock.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      data: null,
      error: null,
      reset: vi.fn(),
    });
    touchStudioUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
    });
    getStudioUrlUseQueryMock.mockReturnValue({
      data: { status: "stopped" },
    });
    projectStatusUseQueryMock.mockReturnValue({
      data: undefined,
    });
    externalPreviewUseQueryMock.mockReturnValue({
      data: {
        status: "ready",
        url: "/vivd-studio/api/preview/site-1/v1/",
        canonicalUrl: "https://preview.example.com/site-1",
      },
    });
    regenerateThumbnailUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    setPublicPreviewEnabledUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    deleteProjectUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    renameSlugUseMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    getMyMembershipUseQueryMock.mockReturnValue({
      data: { organizationRole: "owner" },
    });
    useSessionMock.mockReturnValue({
      data: { user: { id: "user-1", role: "admin" } },
    });
    useThemeMock.mockReturnValue({
      theme: "light",
      colorTheme: "blue",
      setTheme: vi.fn(),
      setColorTheme: vi.fn(),
    });
    useSidebarMock.mockReturnValue({
      toggleSidebar: vi.fn(),
      open: false,
      showImmersivePeek: vi.fn(),
      scheduleHideImmersivePeek: vi.fn(),
    });
    useStudioRuntimeGuardMock.mockReturnValue({
      isRecovering: false,
    });
    resolveStudioRuntimeUrlMock.mockImplementation((baseUrl: string, path?: string) => {
      const resolvedBase = new URL(baseUrl, window.location.origin).toString();
      if (!path) return resolvedBase;
      return new URL(
        path.replace(/^\/+/, ""),
        resolvedBase.endsWith("/") ? resolvedBase : `${resolvedBase}/`,
      ).toString();
    });

    projectListUseQueryMock.mockReturnValue({
      data: { projects: [makeProject()] },
      isLoading: false,
      error: null,
    });
  });

  it("shows loading copy while project list is loading", () => {
    projectListUseQueryMock.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderEmbeddedStudio();

    expect(screen.getByText("Loading project...")).toBeInTheDocument();
  });

  it("shows backend query error details when project list query fails", () => {
    projectListUseQueryMock.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
    });

    renderEmbeddedStudio();

    expect(screen.getByText("Error loading project: boom")).toBeInTheDocument();
  });

  it("shows not-found state when slug is missing from returned projects", () => {
    projectListUseQueryMock.mockReturnValueOnce({
      data: { projects: [makeProject("other-site")] },
      isLoading: false,
      error: null,
    });

    renderEmbeddedStudio();

    expect(screen.getByText("Project not found")).toBeInTheDocument();
  });

  it("shows the publish preview by default without preview-surface controls", () => {
    renderEmbeddedStudio();

    expect(screen.getByTestId("host-header")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toHaveAttribute(
      "data-appearance",
      "brand",
    );
    expect(screen.getByTitle("Preview - site-1")).toHaveAttribute(
      "src",
      "/vivd-studio/api/preview/site-1/v1/",
    );
    expectNoPreviewSurfaceControls();
  });

  it("uses the brand-style sidebar trigger in the embedded studio header", () => {
    renderEmbeddedStudio();

    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toHaveAttribute(
      "data-appearance",
      "brand",
    );
    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toHaveAttribute(
      "data-reveal-on-hover",
      "true",
    );
  });

  it("uses the standard sidebar trigger in the embedded studio header when the sidebar is open", () => {
    useSidebarMock.mockReturnValue({
      toggleSidebar: vi.fn(),
      open: true,
      showImmersivePeek: vi.fn(),
      scheduleHideImmersivePeek: vi.fn(),
    });

    renderEmbeddedStudio();

    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toHaveAttribute(
      "data-appearance",
      "panel",
    );
  });

  it("shows the loading header while the embedded studio iframe is still booting", () => {
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1",
    });
    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "https://studio.example.com/runtime",
        runtimeUrl: "https://studio.example.com/runtime",
        compatibilityUrl: "https://studio.example.com/runtime",
        bootstrapToken: null,
      },
    });

    renderEmbeddedStudio();

    expect(screen.getByTitle("Vivd Studio - site-1")).toBeInTheDocument();
    expect(screen.queryByTitle("Preview - site-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("host-header")).toBeInTheDocument();
    expect(screen.getByText("Starting studio...")).toBeInTheDocument();
    expectNoPreviewSurfaceControls();
  });

  it("uses the compatibility studio route for raw-ip self-host runtimes on non-default ports", () => {
    const locationSnapshot = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...locationSnapshot,
        origin: "http://49.13.48.211",
        href: "http://49.13.48.211/vivd-studio/projects/site-1?view=studio&version=1",
        protocol: "http:",
        host: "49.13.48.211",
        hostname: "49.13.48.211",
        pathname: "/vivd-studio/projects/site-1",
        search: "?view=studio&version=1",
      },
    });
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1",
    });
    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "http://49.13.48.211/_studio/runtime-123",
        browserUrl: "http://49.13.48.211/_studio/runtime-123",
        runtimeUrl: "http://49.13.48.211:4100",
        compatibilityUrl: "http://49.13.48.211/_studio/runtime-123",
        bootstrapToken: null,
      },
    });

    renderEmbeddedStudio();

    const iframe = screen.getByTitle("Vivd Studio - site-1");
    expect(iframe).toHaveAttribute(
      "src",
      expect.stringContaining(
        "http://49.13.48.211/_studio/runtime-123/vivd-studio?embedded=1",
      ),
    );
    expect(iframe).not.toHaveAttribute(
      "src",
      expect.stringContaining("http://49.13.48.211:4100"),
    );
  });

  it("auto-resumes an already running studio without requiring a view query param", () => {
    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "https://studio.example.com/runtime",
        runtimeUrl: "https://studio.example.com/runtime",
        compatibilityUrl: "https://studio.example.com/runtime",
        bootstrapToken: null,
      },
    });

    renderEmbeddedStudio();

    expect(screen.getByTitle("Vivd Studio - site-1")).toBeInTheDocument();
    expect(screen.queryByTitle("Preview - site-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("host-header")).toBeInTheDocument();
    expect(screen.getByText("Starting studio...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("blocks interaction with a reconnect overlay when a resumed studio is waking back up", () => {
    useStudioRuntimeGuardMock.mockReturnValue({
      isRecovering: true,
    });
    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "/_studio/runtime-123",
        runtimeUrl: "/_studio/runtime-123",
        compatibilityUrl: "/_studio/runtime-123",
        bootstrapToken: null,
      },
    });

    const contentWindowMock = {
      postMessage: vi.fn(),
      location: { pathname: "/_studio/runtime-123/vivd-studio" },
    };
    const frameDocument = document.implementation.createHTMLDocument("studio");
    const root = frameDocument.createElement("div");
    root.id = "root";
    root.textContent = "Studio toolbar";
    frameDocument.body.append(root);

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return contentWindowMock;
      },
    });
    Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
      configurable: true,
      get() {
        return frameDocument;
      },
    });

    renderEmbeddedStudio();

    fireEvent.load(screen.getByTitle("Vivd Studio - site-1"));

    expect(screen.getByTestId("studio-recovery-overlay")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Reconnecting studio" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Reconnecting studio")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the host header and shows loading state in the breadcrumb while studio is booting after edit", () => {
    const startStudioMutate = vi.fn();
    startStudioUseMutationMock.mockReturnValue({
      mutate: startStudioMutate,
      isPending: false,
      data: null,
      error: null,
      reset: vi.fn(),
    });

    renderEmbeddedStudio();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(startStudioMutate).toHaveBeenCalledWith({
      slug: "site-1",
      version: 1,
    });
    expect(screen.getByTestId("host-header")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
    expect(screen.getByText("Starting studio...")).toBeInTheDocument();
    expect(screen.getByTestId("studio-startup-loading")).toBeInTheDocument();
  });

  it("polls studio status while waiting for a started machine to become query-visible", () => {
    const startStudioMutate = vi.fn();
    startStudioUseMutationMock.mockReturnValue({
      mutate: startStudioMutate,
      isPending: false,
      data: null,
      error: null,
      reset: vi.fn(),
    });

    renderEmbeddedStudio();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const latestCall = getStudioUrlUseQueryMock.mock.calls.at(-1);
    const options = latestCall?.[1] as
      | {
          refetchInterval?: (query: {
            state: { data?: { status?: string } | undefined };
          }) => number | false;
        }
      | undefined;

    expect(options?.refetchInterval?.({ state: { data: { status: "stopped" } } })).toBe(
      1_000,
    );
    expect(options?.refetchInterval?.({ state: { data: { status: "running" } } })).toBe(
      false,
    );
  });

  it("waits for the backend handoff session before auto-starting studio during initial generation", () => {
    const startStudioMutate = vi.fn();
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1&initialGeneration=1",
    });
    startStudioUseMutationMock.mockReturnValueOnce({
      mutate: startStudioMutate,
      isPending: false,
      data: null,
      error: null,
      reset: vi.fn(),
    });
    getStudioUrlUseQueryMock.mockReturnValueOnce({
      data: { status: "stopped" },
    });
    projectStatusUseQueryMock.mockReturnValueOnce({
      data: {
        status: "starting_studio",
        studioHandoff: {
          mode: "studio_astro",
          initialGeneration: true,
          sessionId: null,
        },
      },
    });

    renderEmbeddedStudio();

    expect(startStudioMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("studio-startup-loading")).toBeInTheDocument();
  });

  it("shows startup loading instead of not-found while initial generation waits for the fresh project list", () => {
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1&initialGeneration=1",
    });
    projectListUseQueryMock.mockReturnValueOnce({
      data: { projects: [makeProject("other-site")] },
      isLoading: false,
      error: null,
    });
    projectStatusUseQueryMock.mockReturnValueOnce({
      data: {
        status: "starting_studio",
        studioHandoff: {
          mode: "studio_astro",
          initialGeneration: true,
          sessionId: null,
        },
      },
    });

    renderEmbeddedStudio();

    expect(screen.getByTestId("studio-startup-loading")).toBeInTheDocument();
    expect(screen.queryByText("Project not found")).not.toBeInTheDocument();
  });

  it("forwards the requested initial session id into the embedded studio URL", () => {
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1&initialGeneration=1&sessionId=sess-1",
    });
    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "https://studio.example.com/runtime",
        bootstrapToken: null,
      },
    });

    renderEmbeddedStudio();

    const iframe = screen.getByTitle("Vivd Studio - site-1");
    const iframeUrl = new URL(iframe.getAttribute("src") ?? "");
    expect(iframeUrl.searchParams.get("initialGeneration")).toBe("1");
    expect(iframeUrl.searchParams.get("sessionId")).toBe("sess-1");

    const returnTo = iframeUrl.searchParams.get("returnTo");
    expect(returnTo).toBeTruthy();
    const returnToUrl = new URL(returnTo!);
    expect(returnToUrl.searchParams.get("initialGeneration")).toBe("1");
    expect(returnToUrl.searchParams.get("sessionId")).toBe("sess-1");
  });

  it("adopts a backend-polled initial session id on the project page", () => {
    const navigateMock = vi.fn();
    useNavigateMock.mockReturnValue(navigateMock);
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1&initialGeneration=1",
    });
    projectStatusUseQueryMock.mockReturnValue({
      data: {
        status: "generating_initial_site",
        studioHandoff: {
          mode: "studio_astro",
          initialGeneration: true,
          sessionId: "sess-polled",
        },
      },
    });
    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "https://studio.example.com/runtime",
        bootstrapToken: null,
      },
    });

    renderEmbeddedStudio();

    expect(navigateMock).not.toHaveBeenCalled();
    const iframe = screen.getByTitle("Vivd Studio - site-1");
    const iframeUrl = new URL(iframe.getAttribute("src") ?? "");
    expect(iframeUrl.searchParams.get("sessionId")).toBe("sess-polled");
  });

  it("does not block Studio boot forever when initial generation is paused without a session id", () => {
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1&initialGeneration=1",
    });
    projectStatusUseQueryMock.mockReturnValue({
      data: {
        status: "initial_generation_paused",
        studioHandoff: {
          mode: "studio_astro",
          initialGeneration: true,
          sessionId: null,
        },
      },
    });
    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "https://studio.example.com/runtime",
        bootstrapToken: null,
      },
    });

    renderEmbeddedStudio();

    const iframe = screen.getByTitle("Vivd Studio - site-1");
    const iframeUrl = new URL(iframe.getAttribute("src") ?? "");
    expect(iframeUrl.searchParams.get("initialGeneration")).toBe("1");
    expect(iframeUrl.searchParams.get("sessionId")).toBeNull();
  });

  it("rewrites the embedded studio bootstrap target when a backend-polled session id appears later", () => {
    const navigateMock = vi.fn();
    useNavigateMock.mockReturnValue(navigateMock);
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1&initialGeneration=1",
    });

    let currentProjectStatus: {
      status: string;
      studioHandoff: {
        mode: "studio_astro";
        initialGeneration: true;
        sessionId: string | null;
      };
    } | undefined = {
      status: "starting_studio",
      studioHandoff: {
        mode: "studio_astro",
        initialGeneration: true,
        sessionId: null,
      },
    };

    projectStatusUseQueryMock.mockImplementation(() => ({
      data: currentProjectStatus,
    }));
    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "http://app.localhost:4102",
        bootstrapToken: "bootstrap-1",
        userActionToken: "user-action-token-1",
      },
    });

    const view = renderEmbeddedStudio();

    expect(HTMLFormElement.prototype.submit).not.toHaveBeenCalled();
    let nextField = document.querySelector(
      'form[target="vivd-studio-embedded-site-1-v1"] input[name="next"]',
    ) as HTMLInputElement | null;
    expect(nextField).toBeNull();

    currentProjectStatus = {
      status: "generating_initial_site",
      studioHandoff: {
        mode: "studio_astro",
        initialGeneration: true,
        sessionId: "sess-polled",
      },
    };

    view.rerender(
      <MemoryRouter>
        <EmbeddedStudio />
      </MemoryRouter>,
    );

    expect(navigateMock).not.toHaveBeenCalled();
    expect(HTMLFormElement.prototype.submit).toHaveBeenCalledTimes(1);
    nextField = document.querySelector(
      'form[target="vivd-studio-embedded-site-1-v1"] input[name="next"]',
    ) as HTMLInputElement | null;
    expect(nextField?.value).toContain("sessionId=sess-polled");
  });

  it("posts the studio bootstrap token to the bootstrap endpoint and keeps the iframe URL clean", () => {
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1",
    });
    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "https://studio.example.com/runtime",
        bootstrapToken: "bootstrap-1",
        userActionToken: "user-action-token-1",
      },
    });

    renderEmbeddedStudio();

    const iframe = screen.getByTitle("Vivd Studio - site-1");
    expect(iframe.getAttribute("src")).toBe("about:blank");

    const bootstrapForm = document.querySelector(
      'form[target="vivd-studio-embedded-site-1-v1"]',
    ) as HTMLFormElement | null;
    expect(bootstrapForm?.getAttribute("action")).toBe(
      "https://studio.example.com/runtime/vivd-studio/api/bootstrap",
    );

    const bootstrapTokenField = bootstrapForm?.querySelector(
      'input[name="bootstrapToken"]',
    ) as HTMLInputElement | null;
    expect(bootstrapTokenField?.value).toBe("bootstrap-1");

    const nextField = bootstrapForm?.querySelector(
      'input[name="next"]',
    ) as HTMLInputElement | null;
    expect(nextField?.value).toContain(
      "https://studio.example.com/runtime/vivd-studio?embedded=1",
    );
    expect(nextField?.value).not.toContain("vivdStudioToken");

    const userActionTokenField = bootstrapForm?.querySelector(
      'input[name="userActionToken"]',
    ) as HTMLInputElement | null;
    expect(userActionTokenField?.value).toBe("user-action-token-1");
    expect(HTMLFormElement.prototype.submit).toHaveBeenCalledOnce();
  });

  it("passes the host sidebar state through to the embedded studio iframe", () => {
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1",
    });
    useSidebarMock.mockReturnValue({
      toggleSidebar: vi.fn(),
      open: true,
      showImmersivePeek: vi.fn(),
      scheduleHideImmersivePeek: vi.fn(),
    });
    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "https://studio.example.com/runtime",
        bootstrapToken: null,
      },
    });

    renderEmbeddedStudio();

    const iframe = screen.getByTitle("Vivd Studio - site-1");
    const iframeUrl = new URL(iframe.getAttribute("src") ?? "");
    expect(iframeUrl.searchParams.get("sidebarOpen")).toBe("1");
  });

  it("treats a same-origin studio iframe load as ready when the shell document is present", () => {
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1",
    });
    const postMessage = vi.fn();
    const contentWindowMock = {
      postMessage,
      location: { pathname: "/_studio/runtime-123/vivd-studio" },
    };
    const frameDocument = document.implementation.createHTMLDocument("studio");
    const root = frameDocument.createElement("div");
    root.id = "root";
    frameDocument.body.append(root);
    const script = frameDocument.createElement("script");
    script.setAttribute(
      "src",
      "/_studio/runtime-123/vivd-studio/assets/index-abc123.js",
    );
    frameDocument.head.append(script);

    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "/_studio/runtime-123",
        bootstrapToken: null,
      },
    });

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return contentWindowMock;
      },
    });
    Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
      configurable: true,
      get() {
        return frameDocument;
      },
    });

    renderEmbeddedStudio();

    const iframe = screen.getByTitle("Vivd Studio - site-1");
    fireEvent.load(iframe);

    expect(screen.queryByTestId("studio-startup-loading")).not.toBeInTheDocument();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "vivd:host:theme" }),
      window.location.origin,
    );
  });

  it("retries same-origin iframe readiness after an early load event", async () => {
    vi.useFakeTimers();

    try {
      useLocationMock.mockReturnValue({
        search: "?view=studio&version=1",
      });
      const postMessage = vi.fn();
      const contentWindowMock = {
        postMessage,
        location: { pathname: "/_studio/runtime-123/vivd-studio" },
      };
      const loadingDocument = document.implementation.createHTMLDocument("loading");
      const shellDocument = document.implementation.createHTMLDocument("studio");
      const root = shellDocument.createElement("div");
      root.id = "root";
      shellDocument.body.append(root);
      const script = shellDocument.createElement("script");
      script.setAttribute(
        "src",
        "/_studio/runtime-123/vivd-studio/assets/index-abc123.js",
      );
      shellDocument.head.append(script);
      let currentDocument = loadingDocument;

      getStudioUrlUseQueryMock.mockReturnValue({
        data: {
          status: "running",
          url: "/_studio/runtime-123",
          bootstrapToken: null,
        },
      });

      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        configurable: true,
        get() {
          return contentWindowMock;
        },
      });
      Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
        configurable: true,
        get() {
          return currentDocument;
        },
      });

      renderEmbeddedStudio();

      const iframe = screen.getByTitle("Vivd Studio - site-1");
      fireEvent.load(iframe);
      expect(screen.getByTestId("studio-startup-loading")).toBeInTheDocument();

      currentDocument = shellDocument;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(screen.queryByTestId("studio-startup-loading")).not.toBeInTheDocument();
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "vivd:host:theme" }),
        window.location.origin,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps retrying same-origin iframe readiness after the timeout screen appears", async () => {
    vi.useFakeTimers();

    try {
      useLocationMock.mockReturnValue({
        search: "?view=studio&version=1",
      });
      const postMessage = vi.fn();
      const contentWindowMock = {
        postMessage,
        location: { pathname: "/_studio/runtime-123/vivd-studio" },
      };
      const loadingDocument = document.implementation.createHTMLDocument("loading");
      const shellDocument = document.implementation.createHTMLDocument("studio");
      const root = shellDocument.createElement("div");
      root.id = "root";
      shellDocument.body.append(root);
      const script = shellDocument.createElement("script");
      script.setAttribute(
        "src",
        "/_studio/runtime-123/vivd-studio/assets/index-abc123.js",
      );
      shellDocument.head.append(script);
      let currentDocument = loadingDocument;

      getStudioUrlUseQueryMock.mockReturnValue({
        data: {
          status: "running",
          url: "/_studio/runtime-123",
          bootstrapToken: null,
        },
      });

      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        configurable: true,
        get() {
          return contentWindowMock;
        },
      });
      Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
        configurable: true,
        get() {
          return currentDocument;
        },
      });

      renderEmbeddedStudio();

      const iframe = screen.getByTitle("Vivd Studio - site-1");
      fireEvent.load(iframe);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(25_100);
      });

      expect(
        screen.getByText("Studio is taking longer than usual"),
      ).toBeInTheDocument();

      currentDocument = shellDocument;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });

      expect(
        screen.queryByText("Studio is taking longer than usual"),
      ).not.toBeInTheDocument();
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "vivd:host:theme" }),
        window.location.origin,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-reloads the iframe when the initial studio document 503s but health becomes ready", async () => {
    vi.useFakeTimers();

    try {
      useLocationMock.mockReturnValue({
        search: "?view=studio&version=1",
      });
      let resolveHealthFetch: ((value: { ok: boolean }) => void) | null = null;
      const fetchMock = vi.fn().mockImplementation(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            resolveHealthFetch = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const postMessage = vi.fn();
      const contentWindowMock = {
        postMessage,
        location: { pathname: "/_studio/runtime-123/vivd-studio" },
      };
      const loadingDocument = document.implementation.createHTMLDocument("loading");
      const shellDocument = document.implementation.createHTMLDocument("studio");
      const root = shellDocument.createElement("div");
      root.id = "root";
      const mountedApp = shellDocument.createElement("div");
      mountedApp.textContent = "Studio";
      root.append(mountedApp);
      shellDocument.body.append(root);
      let currentDocument = loadingDocument;

      getStudioUrlUseQueryMock.mockReturnValue({
        data: {
          status: "running",
          url: "/_studio/runtime-123",
          bootstrapToken: null,
        },
      });

      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        configurable: true,
        get() {
          return contentWindowMock;
        },
      });
      Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
        configurable: true,
        get() {
          return currentDocument;
        },
      });

      renderEmbeddedStudio();

      const iframe = screen.getByTitle("Vivd Studio - site-1");
      fireEvent.load(iframe);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(25_100);
      });

      expect(
        screen.getByText("Studio is taking longer than usual"),
      ).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        `${window.location.origin}/_studio/runtime-123/health`,
        expect.objectContaining({
          method: "GET",
          mode: "cors",
          cache: "no-store",
        }),
      );

      currentDocument = shellDocument;
      await act(async () => {
        resolveHealthFetch?.({ ok: true });
        await Promise.resolve();
      });

      const reloadedIframe = screen.getByTitle("Vivd Studio - site-1");
      expect(reloadedIframe).not.toBe(iframe);
      expect(screen.getByTestId("studio-startup-loading")).toBeInTheDocument();

      fireEvent.load(reloadedIframe);

      expect(screen.queryByTestId("studio-startup-loading")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the requested initial session id when switching to fullscreen", () => {
    const navigateMock = vi.fn();
    const contentWindowMock = { postMessage: vi.fn() };
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1&initialGeneration=1&sessionId=sess-1",
    });
    useNavigateMock.mockReturnValue(navigateMock);
    getStudioUrlUseQueryMock.mockReturnValue({
      data: {
        status: "running",
        url: "https://studio.example.com/runtime",
        bootstrapToken: null,
      },
    });

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return contentWindowMock;
      },
    });

    renderEmbeddedStudio();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vivd:studio:fullscreen" },
          origin: "https://studio.example.com",
          source: contentWindowMock as unknown as MessageEventSource,
        }),
      );
    });

    expect(navigateMock).toHaveBeenCalledWith(
      "/vivd-studio/projects/site-1/studio-fullscreen?version=1&initialGeneration=1&sessionId=sess-1",
    );
  });
});
