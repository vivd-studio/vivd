import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Layout } from "./Layout";

const { useSessionMock, useAppConfigMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  useAppConfigMock: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: useSessionMock,
    signOut: vi.fn(),
  },
}));

vi.mock("@/lib/AppConfigContext", () => ({
  useAppConfig: useAppConfigMock,
}));

vi.mock("@/components/theme", () => ({
  ModeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("./NavigationSearch", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const { NavigationSearchContext } = await vi.importActual<
    typeof import("./navigationSearchContext")
  >("./navigationSearchContext");

  return {
    NavigationSearchProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        NavigationSearchContext.Provider,
        {
          value: {
            isOpen: false,
            openSearch: vi.fn(),
            closeSearch: vi.fn(),
          },
        },
        children,
      ),
  };
});

vi.mock("./AppSidebar", () => ({
  AppSidebar: () => <aside data-testid="app-sidebar" />,
}));

function renderLayout(path = "/vivd-studio") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/vivd-studio" element={<Layout />}>
          <Route index element={<h1>Projects</h1>} />
          <Route path="projects/new/scratch" element={<h1>Scratch</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Layout shell header", () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({
      data: null,
      isPending: false,
    });
    useAppConfigMock.mockReturnValue({
      config: {
        instanceAdminLabel: "Super Admin",
      },
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

  it("shows the projects breadcrumb with a New action on the index", () => {
    renderLayout();

    // Breadcrumb "Projects" + the route's stub <h1>Projects</h1>.
    expect(screen.getAllByText("Projects")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("keeps breadcrumbs on nested project setup routes", () => {
    renderLayout("/vivd-studio/projects/new/scratch");

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("New project")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New" }),
    ).not.toBeInTheDocument();
  });
});
