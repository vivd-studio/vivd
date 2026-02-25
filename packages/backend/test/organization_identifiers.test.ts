import { describe, expect, it } from "vitest";
import {
  normalizeOrganizationId,
  organizationIdSchema,
  organizationSlugSchema,
} from "../src/lib/organizationIdentifiers";

describe("organization identifiers", () => {
  it("accepts mixed-case and underscore organization IDs", () => {
    expect(normalizeOrganizationId(" Org_A1 ")).toBe("Org_A1");
    expect(organizationIdSchema.parse(" Org_A1 ")).toBe("Org_A1");
  });

  it("rejects invalid organization ID characters", () => {
    expect(normalizeOrganizationId("org/a")).toBeNull();
    expect(normalizeOrganizationId("org a")).toBeNull();
    expect(normalizeOrganizationId("org\\a")).toBeNull();
    expect(() => organizationIdSchema.parse("org/a")).toThrow();
    expect(() => organizationIdSchema.parse("org a")).toThrow();
  });

  it("keeps slug validation strict", () => {
    expect(organizationSlugSchema.parse("tenant-1")).toBe("tenant-1");
    expect(() => organizationSlugSchema.parse("Tenant_1")).toThrow();
    expect(() => organizationSlugSchema.parse("tenant 1")).toThrow();
  });
});
