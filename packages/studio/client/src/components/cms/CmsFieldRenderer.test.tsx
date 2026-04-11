import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CmsModelRecord } from "@vivd/shared/cms";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CmsFieldRenderer } from "./CmsFieldRenderer";

vi.mock("./CmsAssetField", () => ({
  CmsAssetField: ({
    fieldId,
    label,
  }: {
    fieldId: string;
    label: string;
  }) => <div data-testid="cms-asset-field">{`${label}:${fieldId}`}</div>,
}));

const selectedModel: CmsModelRecord = {
  key: "team",
  label: "Team",
  schemaPath: "/tmp/content.config.ts",
  relativeSchemaPath: "src/content.config.ts",
  collectionRoot: "/tmp/src/content/team",
  relativeCollectionRoot: "src/content/team",
  entryFormat: "file",
  entryFileExtension: ".yaml",
  directoryIndexEntries: false,
  sortField: null,
  fields: {},
  entries: [],
};

const baseProps = {
  projectSlug: "demo",
  version: 1,
  defaultLocale: "en",
  locales: ["en"],
  selectedEntryRelativePath: "src/content/team/apollo.yaml",
  selectedEntryKey: "apollo",
  selectedModel,
  sidecarDrafts: {},
  canUseAiImages: false,
  readOnly: false,
  referenceOptions: [],
  applyDraftValue: vi.fn(),
  handleRichTextChange: vi.fn(),
  openAssetReference: vi.fn(),
  openExplorer: vi.fn(),
};

describe("CmsFieldRenderer", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders rich image asset UI for obvious string image fields", () => {
    render(
      <CmsFieldRenderer
        {...baseProps}
        fieldKey="profileImage"
        field={{ type: "string" }}
        fieldPath={["profileImage"]}
        draftValues={{ profileImage: "../media/team/apollo.webp" }}
      />,
    );

    expect(screen.getByTestId("cms-asset-field")).toHaveTextContent(
      "Profile Image:profileImage",
    );
  });

  it("renders rich image asset UI for obvious string-list image fields", () => {
    render(
      <CmsFieldRenderer
        {...baseProps}
        fieldKey="galleryImages"
        field={{ type: "list", item: { type: "string" } }}
        fieldPath={["galleryImages"]}
        draftValues={{ galleryImages: ["../media/team/apollo-1.webp"] }}
      />,
    );

    expect(screen.getByTestId("cms-asset-field")).toHaveTextContent(
      "Gallery Images 1:galleryImages.0",
    );
  });
});
