import { describe, expect, it } from "vitest";
import { areStudioCompatibilityRoutesEnabled } from "../src/services/studioMachines/compatibilityRoutePolicy";

describe("areStudioCompatibilityRoutesEnabled", () => {
  it("keeps compatibility routes enabled for solo installs", () => {
    expect(areStudioCompatibilityRoutesEnabled("solo")).toBe(true);
    expect(areStudioCompatibilityRoutesEnabled("solo", "docker")).toBe(true);
  });

  it("enables compatibility routes for local-development docker and local runtimes", () => {
    expect(areStudioCompatibilityRoutesEnabled("platform", "docker", true)).toBe(true);
    expect(areStudioCompatibilityRoutesEnabled("platform", "local")).toBe(true);
    expect(areStudioCompatibilityRoutesEnabled("platform", "local", true)).toBe(true);
  });

  it("keeps compatibility routes disabled for hosted platform runtimes", () => {
    expect(areStudioCompatibilityRoutesEnabled("platform", "docker")).toBe(false);
    expect(areStudioCompatibilityRoutesEnabled("platform", "fly")).toBe(false);
    expect(areStudioCompatibilityRoutesEnabled("platform", "fly", true)).toBe(false);
  });
});
