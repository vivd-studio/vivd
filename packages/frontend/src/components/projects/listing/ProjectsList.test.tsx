import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsList } from "./ProjectsList";

const {
  useUtilsMock,
  listUseQueryMock,
  listTagsUseQueryMock,
  regenerateUseMutationMock,
  generateUseMutationMock,
  deleteUseMutationMock,
  useMutationStateMock,
  toastErrorMock,
  toastLoadingMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  useUtilsMock: vi.fn(),
  listUseQueryMock: vi.fn(),
  listTagsUseQueryMock: vi.fn(),
  regenerateUseMutationMock: vi.fn(),
  generateUseMutationMock: vi.fn(),
  deleteUseMutationMock: vi.fn(),
  useMutationStateMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastLoadingMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    project: {
      list: { useQuery: listUseQueryMock },
      listTags: { useQuery: listTagsUseQueryMock },
      regenerate: { useMutation: regenerateUseMutationMock },
      generate: { useMutation: generateUseMutationMock },
      delete: { useMutation: deleteUseMutationMock },
      duplicateProject: {},
    },
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useMutationState: useMutationStateMock,
}));

vi.mock("@trpc/react-query", () => ({
  getMutationKey: () => ["project", "duplicateProject"],
}));

vi.mock("./ProjectCard", () => ({
  ProjectCard: ({
    project,
    onDelete,
    isDeleting,
  }: {
    project: { slug: string; status?: string };
    onDelete: (slug: string) => void;
    isDeleting?: boolean;
  }) => (
    <div data-testid="project-card">
      <span>{project.slug}</span>
      {project.status ? <span>{project.status}</span> : null}
      {isDeleting ? <span>Deleting {project.slug}</span> : null}
      <button type="button" onClick={() => onDelete(project.slug)}>
        Delete {project.slug}
      </button>
    </div>
  ),
}));

vi.mock("../versioning/VersionDialog", () => ({
  VersionDialog: () => null,
}));

vi.mock("../dialogs/DeleteProjectDialog", () => ({
  DeleteProjectDialog: ({
    open,
    projectName,
    onConfirmDelete,
  }: {
    open: boolean;
    projectName: string;
    onConfirmDelete: (confirmationText: string) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onConfirmDelete(projectName)}>
        Confirm delete {projectName}
      </button>
    ) : null,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    loading: toastLoadingMock,
    success: toastSuccessMock,
  },
}));

function setTrpcProjects(
  projects: Array<{
    slug: string;
    tags?: string[];
    title?: string;
    url: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>,
) {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const refetch = vi.fn().mockResolvedValue(undefined);
  useUtilsMock.mockReturnValue({
    project: {
      list: { invalidate, refetch },
    },
  });
  listUseQueryMock.mockReturnValue({
    data: { projects },
    isLoading: false,
    error: null,
  });
  regenerateUseMutationMock.mockReturnValue({ mutateAsync: vi.fn() });
  generateUseMutationMock.mockReturnValue({ mutateAsync: vi.fn() });
  deleteUseMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useMutationStateMock.mockReturnValue([]);
  listTagsUseQueryMock.mockReturnValue({
    data: {
      tags: Array.from(
        new Set(projects.flatMap((project) => project.tags ?? [])),
      ).map((tag) => ({ tag, colorId: null })),
    },
  });
}

describe("ProjectsList tags filter", () => {
  beforeEach(() => {
    useUtilsMock.mockReset();
    listUseQueryMock.mockReset();
    listTagsUseQueryMock.mockReset();
    regenerateUseMutationMock.mockReset();
    generateUseMutationMock.mockReset();
    deleteUseMutationMock.mockReset();
    useMutationStateMock.mockReset();
    toastErrorMock.mockReset();
    toastLoadingMock.mockReset();
    toastSuccessMock.mockReset();
    localStorage.clear();
  });

  it("keeps tag filtering single-select when switching between tags", () => {
    setTrpcProjects([
      {
        slug: "alpha",
        title: "Alpha",
        url: "https://alpha.example.com",
        tags: ["marketing", "seo"],
        status: "completed",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-10T00:00:00.000Z",
      },
      {
        slug: "beta",
        title: "Beta",
        url: "https://beta.example.com",
        tags: ["marketing"],
        status: "completed",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-09T00:00:00.000Z",
      },
      {
        slug: "gamma",
        title: "Gamma",
        url: "https://gamma.example.com",
        tags: ["internal"],
        status: "completed",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-08T00:00:00.000Z",
      },
    ]);

    render(<ProjectsList />);

    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText("gamma")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Filter by tag marketing" }),
    );

    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.queryByText("gamma")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filter by tag seo" }));

    expect(screen.getByText("alpha")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Filter by tag marketing" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Filter by tag seo" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("beta")).toBeNull();
    expect(screen.queryByText("gamma")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Filter by tag internal" }),
    );

    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.queryByText("beta")).toBeNull();
    expect(screen.getByText("gamma")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText("gamma")).toBeTruthy();
  });

  it("combines text search and the active tag", () => {
    setTrpcProjects([
      {
        slug: "alpha-site",
        title: "Alpha Site",
        url: "https://alpha.example.com",
        tags: ["marketing"],
        status: "completed",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-10T00:00:00.000Z",
      },
      {
        slug: "beta-site",
        title: "Beta Site",
        url: "https://beta.example.com",
        tags: ["marketing"],
        status: "completed",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-09T00:00:00.000Z",
      },
      {
        slug: "internal-dashboard",
        title: "Internal Dashboard",
        url: "https://internal.example.com",
        tags: ["internal"],
        status: "completed",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-08T00:00:00.000Z",
      },
    ]);

    render(<ProjectsList />);

    fireEvent.click(
      screen.getByRole("button", { name: "Filter by tag marketing" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Search projects..."), {
      target: { value: "beta" },
    });

    expect(screen.queryByText("alpha-site")).toBeNull();
    expect(screen.getByText("beta-site")).toBeTruthy();
    expect(screen.queryByText("internal-dashboard")).toBeNull();
  });

  it("marks the affected project as deleting as soon as delete starts", () => {
    setTrpcProjects([
      {
        slug: "alpha",
        title: "Alpha",
        url: "https://alpha.example.com",
        tags: [],
        status: "completed",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-10T00:00:00.000Z",
      },
      {
        slug: "beta",
        title: "Beta",
        url: "https://beta.example.com",
        tags: [],
        status: "completed",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-09T00:00:00.000Z",
      },
    ]);

    let deleteOptions:
      | {
          onMutate?: (variables: {
            slug: string;
            confirmationText: string;
          }) => void;
        }
      | undefined;
    const mutate = vi.fn((variables) => deleteOptions?.onMutate?.(variables));
    deleteUseMutationMock.mockImplementation((options) => {
      deleteOptions = options;
      return { mutate, isPending: false };
    });

    render(<ProjectsList />);

    fireEvent.click(screen.getByRole("button", { name: "Delete alpha" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm delete alpha" }),
    );

    expect(mutate).toHaveBeenCalledWith({
      slug: "alpha",
      confirmationText: "alpha",
    });
    expect(screen.getByText("Deleting alpha")).toBeTruthy();
    expect(screen.queryByText("Deleting beta")).toBeNull();
    expect(toastLoadingMock).toHaveBeenCalledWith("Deleting project", {
      id: "delete-project-alpha",
      description: "alpha",
    });
  });

  it("keeps pending duplicate projects visible even when the list query does not include them yet", () => {
    setTrpcProjects([
      {
        slug: "alpha",
        title: "Alpha",
        url: "https://alpha.example.com",
        tags: ["marketing"],
        status: "completed",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-10T00:00:00.000Z",
      },
    ]);
    useMutationStateMock.mockReturnValue([
      {
        variables: {
          sourceSlug: "alpha",
          sourceVersion: 1,
          title: "Alpha copy",
          slug: "alpha-copy",
        },
        submittedAt: Date.parse("2026-02-10T12:00:00.000Z"),
      },
    ]);

    render(<ProjectsList />);

    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("alpha-copy")).toBeTruthy();
    expect(screen.getByText("duplicating_project")).toBeTruthy();
  });
});
