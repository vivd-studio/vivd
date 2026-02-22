import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsList } from "./ProjectsList";

const {
  useUtilsMock,
  listUseQueryMock,
  regenerateUseMutationMock,
  generateUseMutationMock,
  deleteUseMutationMock,
} = vi.hoisted(() => ({
  useUtilsMock: vi.fn(),
  listUseQueryMock: vi.fn(),
  regenerateUseMutationMock: vi.fn(),
  generateUseMutationMock: vi.fn(),
  deleteUseMutationMock: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    project: {
      list: { useQuery: listUseQueryMock },
      regenerate: { useMutation: regenerateUseMutationMock },
      generate: { useMutation: generateUseMutationMock },
      delete: { useMutation: deleteUseMutationMock },
    },
  },
}));

vi.mock("./ProjectCard", () => ({
  ProjectCard: ({ project }: { project: { slug: string } }) => (
    <div data-testid="project-card">{project.slug}</div>
  ),
}));

vi.mock("../versioning/VersionDialog", () => ({
  VersionDialog: () => null,
}));

vi.mock("../dialogs/DeleteProjectDialog", () => ({
  DeleteProjectDialog: () => null,
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
  useUtilsMock.mockReturnValue({
    project: {
      list: { invalidate },
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
}

describe("ProjectsList tags filter", () => {
  beforeEach(() => {
    useUtilsMock.mockReset();
    listUseQueryMock.mockReset();
    regenerateUseMutationMock.mockReset();
    generateUseMutationMock.mockReset();
    deleteUseMutationMock.mockReset();
    localStorage.clear();
  });

  it("filters by selected tags with match-all semantics", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Filter by tag marketing" }));

    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.queryByText("gamma")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filter by tag seo" }));

    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.queryByText("beta")).toBeNull();
    expect(screen.queryByText("gamma")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText("gamma")).toBeTruthy();
  });

  it("combines text search and selected tags", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Filter by tag marketing" }));
    fireEvent.change(screen.getByPlaceholderText("Search projects..."), {
      target: { value: "beta" },
    });

    expect(screen.queryByText("alpha-site")).toBeNull();
    expect(screen.getByText("beta-site")).toBeTruthy();
    expect(screen.queryByText("internal-dashboard")).toBeNull();
  });
});
