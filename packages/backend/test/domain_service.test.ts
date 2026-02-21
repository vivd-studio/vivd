import { describe, expect, it } from "vitest";
import {
  RESERVED_ORG_SLUG_LABELS,
  validateOrganizationSlug,
} from "../src/services/publish/DomainService";

describe("DomainService organization slug validation", () => {
  it("keeps API slug reserved", () => {
    expect(RESERVED_ORG_SLUG_LABELS).toContain("api");
  });

  it("rejects every reserved slug label", () => {
    for (const label of RESERVED_ORG_SLUG_LABELS) {
      expect(validateOrganizationSlug(label)).toEqual({
        valid: false,
        error: `Organization slug "${label}" is reserved`,
      });
    }
  });

  it("allows non-reserved labels", () => {
    expect(validateOrganizationSlug("acme")).toEqual({ valid: true });
  });
});
