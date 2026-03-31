import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useNavigateMock,
  useAppConfigMock,
  formatDocumentTitleMock,
  useUtilsMock,
  createScratchDraftUseMutationMock,
  startScratchGenerationUseMutationMock,
  projectStatusUseQueryMock,
} = vi.hoisted(() => ({
  useNavigateMock: vi.fn(),
  useAppConfigMock: vi.fn(),
  formatDocumentTitleMock: vi.fn(),
  useUtilsMock: vi.fn(),
  createScratchDraftUseMutationMock: vi.fn(),
  startScratchGenerationUseMutationMock: vi.fn(),
  projectStatusUseQueryMock: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useNavigate: useNavigateMock,
  };
});

vi.mock("@/lib/AppConfigContext", () => ({
  useAppConfig: useAppConfigMock,
}));

vi.mock("@/lib/brand", () => ({
  BRAND_NAME: "Vivd",
  formatDocumentTitle: formatDocumentTitleMock,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    project: {
      createScratchDraft: { useMutation: createScratchDraftUseMutationMock },
      startScratchGeneration: {
        useMutation: startScratchGenerationUseMutationMock,
      },
      status: { useQuery: projectStatusUseQueryMock },
    },
  },
}));

import { ScratchWizardProvider, useScratchWizard } from "./ScratchWizardContext";

function ScratchWizardTestHarness() {
  const { submit, form } = useScratchWizard();

  return (
    <button
      type="button"
      onClick={() =>
        void submit({
          title: "Acme Studio",
          businessType: "",
          description: "Build a polished marketing site.",
          referenceUrlsText: "",
        })
      }
    >
      {String(form.formState.isSubmitting)}
    </button>
  );
}

function renderProvider() {
  return render(
    <MemoryRouter initialEntries={["/vivd-studio/projects/new/scratch"]}>
      <ScratchWizardProvider>
        <ScratchWizardTestHarness />
      </ScratchWizardProvider>
    </MemoryRouter>,
  );
}

describe("ScratchWizardContext", () => {
  beforeEach(() => {
    useNavigateMock.mockReset();
    useAppConfigMock.mockReset();
    formatDocumentTitleMock.mockReset();
    useUtilsMock.mockReset();
    createScratchDraftUseMutationMock.mockReset();
    startScratchGenerationUseMutationMock.mockReset();
    projectStatusUseQueryMock.mockReset();

    useNavigateMock.mockReturnValue(vi.fn());
    useAppConfigMock.mockReturnValue({
      config: {
        singleProjectMode: false,
      },
    });
    formatDocumentTitleMock.mockImplementation(
      (title?: string) => title ?? "Vivd",
    );

    const invalidateMock = vi.fn().mockResolvedValue(undefined);
    useUtilsMock.mockReturnValue({
      project: {
        list: { invalidate: invalidateMock },
      },
    });

    createScratchDraftUseMutationMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        slug: "site-1",
        version: 1,
      }),
    });
    startScratchGenerationUseMutationMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        status: "starting_studio",
        slug: "site-1",
        version: 1,
        studioHandoff: {
          mode: "studio_astro",
          initialGeneration: true,
          sessionId: "sess-1",
        },
      }),
    });
  });

  it("redirects to Studio when the polled project status enters the Studio startup states", async () => {
    const navigateMock = vi.fn();
    useNavigateMock.mockReturnValue(navigateMock);

    let currentStatus: string | undefined;
    projectStatusUseQueryMock.mockImplementation((input: { slug: string }, options: { enabled: boolean }) => {
      if (!options.enabled || !input.slug) {
        return { data: undefined };
      }
      return {
        data: currentStatus ? { status: currentStatus } : undefined,
      };
    });

    const view = renderProvider();

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(projectStatusUseQueryMock).toHaveBeenCalledWith(
        { slug: "site-1", version: 1 },
        expect.objectContaining({ enabled: true }),
      );
    });

    currentStatus = "generating_initial_site";
    view.rerender(
      <MemoryRouter initialEntries={["/vivd-studio/projects/new/scratch"]}>
        <ScratchWizardProvider>
          <ScratchWizardTestHarness />
        </ScratchWizardProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        "/vivd-studio/projects/site-1?view=studio&version=1&initialGeneration=1&sessionId=sess-1",
        { replace: true },
      );
    });
  });

  it("hands over to the project route as soon as backend status enters studio startup", async () => {
    const navigateMock = vi.fn();
    useNavigateMock.mockReturnValue(navigateMock);

    const pendingStartGeneration = new Promise(() => undefined);
    startScratchGenerationUseMutationMock.mockReturnValue({
      mutateAsync: vi.fn().mockReturnValue(pendingStartGeneration),
    });

    let currentStatus:
      | {
          status: string;
          studioHandoff?: {
            mode?: string;
            initialGeneration?: boolean;
            sessionId?: string | null;
          };
        }
      | undefined;
    projectStatusUseQueryMock.mockImplementation((input: { slug: string }, options: { enabled: boolean }) => {
      if (!options.enabled || !input.slug) {
        return { data: undefined };
      }
      return {
        data: currentStatus,
      };
    });

    const view = renderProvider();

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(projectStatusUseQueryMock).toHaveBeenCalledWith(
        { slug: "site-1", version: 1 },
        expect.objectContaining({ enabled: true }),
      );
    });

    currentStatus = {
      status: "starting_studio",
      studioHandoff: {
        mode: "studio_astro",
        initialGeneration: true,
        sessionId: null,
      },
    };
    view.rerender(
      <MemoryRouter initialEntries={["/vivd-studio/projects/new/scratch"]}>
        <ScratchWizardProvider>
          <ScratchWizardTestHarness />
        </ScratchWizardProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        "/vivd-studio/projects/site-1?view=studio&version=1&initialGeneration=1",
        { replace: true },
      );
    });
  });

  it("still hands over to Studio when polling first observes a completed status with a session id", async () => {
    const navigateMock = vi.fn();
    useNavigateMock.mockReturnValue(navigateMock);

    const pendingStartGeneration = new Promise(() => undefined);
    startScratchGenerationUseMutationMock.mockReturnValue({
      mutateAsync: vi.fn().mockReturnValue(pendingStartGeneration),
    });

    let currentStatus:
      | {
          status: string;
          studioHandoff?: {
            mode?: string;
            initialGeneration?: boolean;
            sessionId?: string | null;
          };
        }
      | undefined;
    projectStatusUseQueryMock.mockImplementation((input: { slug: string }, options: { enabled: boolean }) => {
      if (!options.enabled || !input.slug) {
        return { data: undefined };
      }
      return {
        data: currentStatus,
      };
    });

    const view = renderProvider();

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(projectStatusUseQueryMock).toHaveBeenCalledWith(
        { slug: "site-1", version: 1 },
        expect.objectContaining({ enabled: true }),
      );
    });

    currentStatus = {
      status: "completed",
      studioHandoff: {
        mode: "studio_astro",
        initialGeneration: true,
        sessionId: "sess-complete",
      },
    };
    view.rerender(
      <MemoryRouter initialEntries={["/vivd-studio/projects/new/scratch"]}>
        <ScratchWizardProvider>
          <ScratchWizardTestHarness />
        </ScratchWizardProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        "/vivd-studio/projects/site-1?view=studio&version=1&initialGeneration=1&sessionId=sess-complete",
        { replace: true },
      );
    });
  });

  it("does not let a stale prior handoff suppress navigation for a later project", async () => {
    const navigateMock = vi.fn();
    useNavigateMock.mockReturnValue(navigateMock);

    createScratchDraftUseMutationMock.mockReturnValue({
      mutateAsync: vi
        .fn()
        .mockResolvedValueOnce({
          slug: "site-1",
          version: 1,
        })
        .mockResolvedValueOnce({
          slug: "site-2",
          version: 1,
        }),
    });
    startScratchGenerationUseMutationMock.mockReturnValue({
      mutateAsync: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });

    let currentSlug: string | null = null;
    projectStatusUseQueryMock.mockImplementation((input: { slug: string }, options: { enabled: boolean }) => {
      if (!options.enabled || !input.slug) {
        return { data: undefined };
      }
      currentSlug = input.slug;
      return {
        data:
          input.slug === "site-1"
            ? {
                status: "starting_studio",
                studioHandoff: {
                  mode: "studio_astro",
                  initialGeneration: true,
                  sessionId: "sess-1",
                },
              }
            : {
                status: "starting_studio",
                studioHandoff: {
                  mode: "studio_astro",
                  initialGeneration: true,
                  sessionId: "sess-2",
                },
              },
      };
    });

    const view = renderProvider();

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(currentSlug).toBe("site-1");
      expect(navigateMock).toHaveBeenCalledWith(
        "/vivd-studio/projects/site-1?view=studio&version=1&initialGeneration=1&sessionId=sess-1",
        { replace: true },
      );
    });

    navigateMock.mockClear();

    fireEvent.click(screen.getByRole("button"));
    view.rerender(
      <MemoryRouter initialEntries={["/vivd-studio/projects/new/scratch"]}>
        <ScratchWizardProvider>
          <ScratchWizardTestHarness />
        </ScratchWizardProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(currentSlug).toBe("site-2");
      expect(navigateMock).toHaveBeenCalledWith(
        "/vivd-studio/projects/site-2?view=studio&version=1&initialGeneration=1&sessionId=sess-2",
        { replace: true },
      );
    });
  });

});
