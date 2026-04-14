import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
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

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder ?? ""}</span>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({
    children,
    value,
  }: {
    children: ReactNode;
    value: string;
  }) => <div data-testid="select-item" data-value={value}>{children}</div>,
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

  it("renders rich file asset UI for string fields with PDF references", () => {
    render(
      <CmsFieldRenderer
        {...baseProps}
        fieldKey="safetySheet"
        field={{ type: "string" }}
        fieldPath={["safetySheet"]}
        draftValues={{ safetySheet: "/pdfs/products/apollo/safety-sheet.pdf" }}
      />,
    );

    expect(screen.getByTestId("cms-asset-field")).toHaveTextContent(
      "Safety Sheet:safetySheet",
    );
  });

  it("renders localized file asset UI for localized string fields with asset accepts", () => {
    render(
      <CmsFieldRenderer
        {...baseProps}
        fieldKey="hrefByLang"
        field={{ type: "string", localized: true, accepts: [".pdf", "application/pdf"] }}
        fieldPath={["hrefByLang"]}
        draftValues={{
          hrefByLang: {
            de: "/pdfs/products/apollo/de.pdf",
            en: "/pdfs/products/apollo/en.pdf",
          },
        }}
      />,
    );

    expect(
      screen.getAllByTestId("cms-asset-field").map((element) => element.textContent),
    ).toEqual(expect.arrayContaining(["DE:hrefByLang.de", "EN:hrefByLang.en"]));
  });

  it("filters reference picker options to the target collection while accepting bare Astro ids", () => {
    render(
      <CmsFieldRenderer
        {...baseProps}
        fieldKey="productGroup"
        field={{
          type: "reference",
          referenceModelKey: "productGroups",
        }}
        fieldPath={["productGroup"]}
        draftValues={{ productGroup: "chemistry" }}
        referenceOptions={[
          {
            value: "productGroups:chemistry",
            label: "Product Groups / Chemistry",
            modelKey: "productGroups",
            entryKey: "chemistry",
          },
          {
            value: "products:apollo",
            label: "Products / Apollo",
            modelKey: "products",
            entryKey: "apollo",
          },
        ]}
      />,
    );

    expect(
      screen.getAllByTestId("select-item").map((element) => element.getAttribute("data-value")),
    ).toEqual(["__empty__", "productGroups:chemistry"]);
    expect(screen.getByText("Product Groups / Chemistry")).toBeInTheDocument();
    expect(screen.queryByText("Products / Apollo")).not.toBeInTheDocument();
  });
});
