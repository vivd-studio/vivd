import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  useParamsMock,
  useLocationMock,
  useNavigateMock,
  useUtilsMock,
  projectListUseQueryMock,
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
  SidebarTrigger: () => <button type="button">Sidebar</button>,
  useSidebar: useSidebarMock,
}));

vi.mock("@/components/shell", () => ({
  HeaderProfileMenu: () => <div data-testid="profile-menu" />,
}));

vi.mock("@/components/projects/publish/PublishSiteDialog", () => ({
  PublishSiteDialog: () => <div data-testid="publish-dialog" />,
}));

vi.mock("@/components/common/StudioStartupLoading", () => ({
  StudioStartupLoading: () => <div data-testid="studio-startup-loading" />,
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

describe("EmbeddedStudio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    window.sessionStorage.clear();
    useParamsMock.mockReset();
    useLocationMock.mockReset();
    useNavigateMock.mockReset();
    useUtilsMock.mockReset();
    projectListUseQueryMock.mockReset();
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
    externalPreviewUseQueryMock.mockReturnValue({
      data: { status: "ready", url: "https://preview.example.com/site-1" },
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
    });
    useStudioRuntimeGuardMock.mockReturnValue({
      isRecovering: false,
    });
    resolveStudioRuntimeUrlMock.mockImplementation((baseUrl: string, path?: string) => {
      if (!path) return baseUrl;
      return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
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

  it("auto-starts studio when initial generation is requested and no runtime is active", () => {
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

    renderEmbeddedStudio();

    expect(startStudioMutate).toHaveBeenCalledWith({
      slug: "site-1",
      version: 1,
    });
  });

  it("posts the initial-generation bootstrap message once after studio is ready", () => {
    const postMessage = vi.fn();
    const contentWindowMock = { postMessage };
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1&initialGeneration=1",
    });
    getStudioUrlUseQueryMock.mockReturnValueOnce({
      data: {
        status: "running",
        url: "https://studio.example.com/runtime",
        accessToken: null,
      },
    });

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return contentWindowMock;
      },
    });

    renderEmbeddedStudio();

    screen.getByTitle("Vivd Studio - site-1");
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vivd:studio:ready" },
          source: contentWindowMock as unknown as MessageEventSource,
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vivd:studio:ready" },
          source: contentWindowMock as unknown as MessageEventSource,
        }),
      );
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "vivd:host:start-initial-generation" }),
      "*",
    );
    expect(
      postMessage.mock.calls.filter(
        ([message]) =>
          message?.type === "vivd:host:start-initial-generation",
      ),
    ).toHaveLength(1);
  });

  it("treats a same-origin studio iframe load as ready when the shell document is present", () => {
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

    getStudioUrlUseQueryMock.mockReturnValueOnce({
      data: {
        status: "running",
        url: "http://app.localhost/_studio/runtime-123",
        accessToken: null,
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
      "*",
    );
  });

  it("retries same-origin iframe readiness after an early load event", async () => {
    vi.useFakeTimers();

    try {
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
          url: "http://app.localhost/_studio/runtime-123",
          accessToken: null,
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
        "*",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps retrying same-origin iframe readiness after the timeout screen appears", async () => {
    vi.useFakeTimers();

    try {
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
          url: "http://app.localhost/_studio/runtime-123",
          accessToken: null,
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
        "*",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-reloads the iframe when the initial studio document 503s but health becomes ready", async () => {
    vi.useFakeTimers();

    try {
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
          url: "http://app.localhost/_studio/runtime-123",
          accessToken: null,
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
        "http://app.localhost/_studio/runtime-123/health",
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

  it("does not replay initial generation after the bootstrap was already consumed in this tab", () => {
    const postMessage = vi.fn();
    const contentWindowMock = { postMessage };
    useLocationMock.mockReturnValue({
      search: "?view=studio&version=1&initialGeneration=1",
    });
    getStudioUrlUseQueryMock.mockReturnValueOnce({
      data: {
        status: "running",
        url: "https://studio.example.com/runtime",
        accessToken: null,
      },
    });
    window.sessionStorage.setItem(
      "vivd.initialGenerationBootstrapped:site-1:v1",
      "1",
    );

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
          data: { type: "vivd:studio:ready" },
          source: contentWindowMock as unknown as MessageEventSource,
        }),
      );
    });

    expect(
      postMessage.mock.calls.some(
        ([message]) =>
          message?.type === "vivd:host:start-initial-generation",
      ),
    ).toBe(false);
  });
});
