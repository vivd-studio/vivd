export type CmsBindingInput = {
  collection: string;
  entry: string;
  field: string;
  kind: "text" | "asset";
  locale?: string;
};

export function cmsBindingAttrs(binding: CmsBindingInput) {
  return {
    "data-cms-collection": binding.collection,
    "data-cms-entry": binding.entry,
    "data-cms-field": binding.field,
    "data-cms-kind": binding.kind,
    ...(binding.locale ? { "data-cms-locale": binding.locale } : {}),
  };
}
