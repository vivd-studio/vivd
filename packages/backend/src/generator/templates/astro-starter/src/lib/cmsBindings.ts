// vivd-cms-toolkit-version: 1
export type CmsBindingFieldPath = string | Array<string | number>;
export type CmsLocalizedTextValue =
  | string
  | number
  | Record<string, string | number | null | undefined>;

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

function normalizeCmsLocale(locale?: string): string {
  return typeof locale === "string" ? locale.trim() : "";
}

export function resolveCmsTextValue(
  value: CmsLocalizedTextValue | undefined,
  locale?: string,
  defaultLocale?: string,
): string | number | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  if (!value || Array.isArray(value)) {
    return undefined;
  }

  const localeMap = value as Record<string, string | number | null | undefined>;
  const activeLocale = normalizeCmsLocale(locale);
  if (activeLocale) {
    const localized = localeMap[activeLocale];
    if (typeof localized === "string" || typeof localized === "number") {
      return localized;
    }
  }

  const fallbackLocale = normalizeCmsLocale(defaultLocale);
  if (fallbackLocale) {
    const fallback = localeMap[fallbackLocale];
    if (typeof fallback === "string" || typeof fallback === "number") {
      return fallback;
    }
  }

  for (const candidate of Object.values(localeMap)) {
    if (typeof candidate === "string" || typeof candidate === "number") {
      return candidate;
    }
  }

  return undefined;
}

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
