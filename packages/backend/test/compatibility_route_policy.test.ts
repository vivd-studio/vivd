import { describe, expect, it } from "vitest";
import { areStudioCompatibilityRoutesEnabled } from "../src/services/studioMachines/compatibilityRoutePolicy";

describe("areStudioCompatibilityRoutesEnabled", () => {
  it("keeps compatibility routes enabled for path-based control-plane installs", () => {
    expect(areStudioCompatibilityRoutesEnabled("path_based")).toBe(true);
    expect(areStudioCompatibilityRoutesEnabled("path_based", "docker")).toBe(true);
  });

  it("enables compatibility routes for local-development docker and local runtimes", () => {
    expect(areStudioCompatibilityRoutesEnabled("host_based", "docker", true)).toBe(true);
    expect(areStudioCompatibilityRoutesEnabled("host_based", "local")).toBe(true);
    expect(areStudioCompatibilityRoutesEnabled("host_based", "local", true)).toBe(true);
  });

  it("keeps compatibility routes disabled for hosted platform runtimes", () => {
    expect(areStudioCompatibilityRoutesEnabled("host_based", "docker")).toBe(false);
    expect(areStudioCompatibilityRoutesEnabled("host_based", "fly")).toBe(false);
    expect(areStudioCompatibilityRoutesEnabled("host_based", "fly", true)).toBe(false);
  });
});
