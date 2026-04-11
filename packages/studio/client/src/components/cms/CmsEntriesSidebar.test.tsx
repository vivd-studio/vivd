import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CmsModelRecord } from "@vivd/shared/cms";
import { CmsEntriesSidebar } from "./CmsEntriesSidebar";

function buildModel(
  key: string,
  label: string,
  entries: Array<{ key: string; title: string; sortOrder: number }>,
): CmsModelRecord {
  return {
    key,
    label,
    schemaPath: `/tmp/${key}/config.ts`,
    relativeSchemaPath: `src/content/${key}/config.ts`,
    collectionRoot: `/tmp/${key}`,
    relativeCollectionRoot: `src/content/${key}`,
    entryFormat: "file",
    sortField: "sortOrder",
    fields: {
      title: { type: "string" },
    } as CmsModelRecord["fields"],
    display: {
      primaryField: "title",
    },
    entries: entries.map((entry) => ({
      key: entry.key,
      filePath: `/tmp/${key}/${entry.key}.yaml`,
      relativePath: `src/content/${key}/${entry.key}.yaml`,
      deletePath: `src/content/${key}/${entry.key}.yaml`,
      values: {
        title: entry.title,
      },
      slug: null,
      status: "active",
      sortOrder: entry.sortOrder,
      assetRefs: [],
    })),
  };
}

describe("CmsEntriesSidebar", () => {
  afterEach(() => {
    cleanup();
  });

  it("filters entries by title and key", async () => {
    const selectedModel = buildModel("horses", "Horse", [
      { key: "apollo", title: "Apollo", sortOrder: 1 },
      { key: "shadow-runner", title: "Shadow", sortOrder: 2 },
      { key: "luna", title: "Luna", sortOrder: 3 },
    ]);

    render(
      <CmsEntriesSidebar
        selectedModel={selectedModel}
        selectedEntryKey="apollo"
        defaultLocale="en"
        reportErrors={[]}
        allowCreateEntry={true}
        creatingEntry={false}
        newEntryKey=""
        isScaffoldingEntry={false}
        onToggleCreateEntry={vi.fn()}
        onNewEntryKeyChange={vi.fn()}
        onCreateEntry={vi.fn()}
        onCancelCreateEntry={vi.fn()}
        onSelectEntry={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Search entries" }), {
      target: { value: "runner" },
    });

    await waitFor(() => {
      expect(screen.getByText("Shadow")).toBeInTheDocument();
    });
    expect(screen.queryByText("Apollo")).not.toBeInTheDocument();
    expect(screen.queryByText("Luna")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 entries")).toBeInTheDocument();
  });

  it("clears the search query when switching collections", async () => {
    const horseModel = buildModel("horses", "Horse", [
      { key: "apollo", title: "Apollo", sortOrder: 1 },
      { key: "storm", title: "Storm", sortOrder: 2 },
    ]);
    const dogModel = buildModel("dogs", "Dog", [
      { key: "atlas", title: "Atlas", sortOrder: 1 },
      { key: "miso", title: "Miso", sortOrder: 2 },
    ]);

    const view = render(
      <CmsEntriesSidebar
        selectedModel={horseModel}
        selectedEntryKey="apollo"
        defaultLocale="en"
        reportErrors={[]}
        allowCreateEntry={true}
        creatingEntry={false}
        newEntryKey=""
        isScaffoldingEntry={false}
        onToggleCreateEntry={vi.fn()}
        onNewEntryKeyChange={vi.fn()}
        onCreateEntry={vi.fn()}
        onCancelCreateEntry={vi.fn()}
        onSelectEntry={vi.fn()}
      />,
    );

    const searchInput = screen.getByRole("textbox", { name: "Search entries" });
    fireEvent.change(searchInput, {
      target: { value: "storm" },
    });

    await waitFor(() => {
      expect(searchInput).toHaveValue("storm");
    });

    view.rerender(
      <CmsEntriesSidebar
        selectedModel={dogModel}
        selectedEntryKey="atlas"
        defaultLocale="en"
        reportErrors={[]}
        allowCreateEntry={true}
        creatingEntry={false}
        newEntryKey=""
        isScaffoldingEntry={false}
        onToggleCreateEntry={vi.fn()}
        onNewEntryKeyChange={vi.fn()}
        onCreateEntry={vi.fn()}
        onCancelCreateEntry={vi.fn()}
        onSelectEntry={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Search entries" })).toHaveValue("");
    });
    expect(screen.getByText("Atlas")).toBeInTheDocument();
    expect(screen.getByText("Miso")).toBeInTheDocument();
  });
});
