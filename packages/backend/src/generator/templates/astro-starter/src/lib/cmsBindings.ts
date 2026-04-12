export type CmsBindingFieldPath = string | Array<string | number>;

function formatCmsFieldPath(field: CmsBindingFieldPath): string {
  if (typeof field === "string") {
    return field;
  }

  return field.reduce<string>((path, segment, index) => {
    const token = typeof segment === "number" ? `[${segment}]` : String(segment);
    if (typeof segment === "number") {
      return `${path}${token}`;
    }
    return index === 0 ? token : `${path}.${token}`;
  }, "");
}

export type CmsBindingInput = {
  collection: string;
  entry: string;
  field: CmsBindingFieldPath;
  kind: "text" | "asset";
  locale?: string;
};

export type CmsTextBindingInput = Omit<CmsBindingInput, "kind">;
export type CmsAssetBindingInput = Omit<CmsBindingInput, "kind">;
export type CmsEntryBindingInput = {
  collection: string;
  entry: string;
  locale?: string;
};

export function cmsBindingAttrs(binding: CmsBindingInput) {
  return {
    "data-cms-collection": binding.collection,
    "data-cms-entry": binding.entry,
    "data-cms-field": formatCmsFieldPath(binding.field),
    "data-cms-kind": binding.kind,
    ...(binding.locale ? { "data-cms-locale": binding.locale } : {}),
  };
}

export function cmsTextBindingAttrs(binding: CmsTextBindingInput) {
  return cmsBindingAttrs({ ...binding, kind: "text" });
}

export function cmsAssetBindingAttrs(binding: CmsAssetBindingInput) {
  return cmsBindingAttrs({ ...binding, kind: "asset" });
}

export function bindCmsEntry(binding: CmsEntryBindingInput) {
  return {
    text(field: CmsBindingFieldPath) {
      return cmsTextBindingAttrs({ ...binding, field });
    },
    asset(field: CmsBindingFieldPath) {
      return cmsAssetBindingAttrs({ ...binding, field });
    },
  };
}
