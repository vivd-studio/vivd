import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CmsModelRecord } from "@vivd/shared/cms";
import { CmsEntryEditor } from "./CmsEntryEditor";

vi.mock("@/components/theme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    readOnly,
  }: {
    value: string;
    readOnly?: boolean;
  }) => (
    <textarea
      data-testid="mock-codemirror"
      value={value}
      readOnly={readOnly}
      onChange={() => undefined}
    />
  ),
}));

const selectedModel: CmsModelRecord = {
  key: "blog",
  label: "Blog",
  schemaPath: "/tmp/src/content.config.ts",
  relativeSchemaPath: "src/content.config.ts",
  collectionRoot: "/tmp/src/content/blog",
  relativeCollectionRoot: "src/content/blog",
  entryFormat: "file",
  entryFileExtension: ".md",
  directoryIndexEntries: false,
  sortField: null,
  fields: {
    title: { type: "string", required: true },
  },
  entries: [
    {
      key: "hello-world",
      filePath: "/tmp/src/content/blog/hello-world.md",
      relativePath: "src/content/blog/hello-world.md",
      deletePath: "/tmp/src/content/blog/hello-world.md",
      values: {
        title: "Hello world",
      },
      slug: "hello-world",
      status: null,
      sortOrder: null,
      assetRefs: [],
    },
  ],
};

describe("CmsEntryEditor", () => {
  it("renders the markdown body editor for markdown-backed entries", () => {
    render(
      <CmsEntryEditor
        projectSlug="demo"
        version={1}
        selectedModel={selectedModel}
        selectedEntryKey="hello-world"
        draftValues={{ title: "Hello world" }}
        defaultLocale="en"
        locales={["en"]}
        activeLocale={null}
        sidecarDrafts={{}}
        canUseAiImages={false}
        referenceOptions={[]}
        reportErrors={[]}
        sourceKind="astro-collections"
        readOnly={false}
        readOnlyMessage={null}
        isDirty={false}
        busy={false}
        isSaving={false}
        loadingSidecars={false}
        markdownBody="# Hello\n\nBody copy."
        loadingMarkdownBody={false}
        setEditingTextFile={vi.fn()}
        applyDraftValue={vi.fn()}
        handleRichTextChange={vi.fn()}
        openAssetReference={vi.fn()}
        openExplorer={vi.fn()}
        onMoveEntry={vi.fn()}
        onMarkdownBodyChange={vi.fn()}
        onActiveLocaleChange={vi.fn()}
        onSaveEntry={vi.fn()}
        onDeleteEntry={vi.fn()}
      />,
    );

    expect(screen.getByText("Markdown body")).toBeInTheDocument();
    expect(screen.getByTestId("mock-codemirror")).toHaveValue("# Hello\n\nBody copy.");
  });
});
