import { describe, expect, it } from "vitest";
import {
  StudioAgentLeaseService,
  type StudioAgentLeaseState,
} from "../src/services/project/StudioAgentLeaseService";

function identity(overrides: Partial<{
  organizationId: string;
  slug: string;
  version: number;
  studioId: string;
  sessionId: string;
  runId: string;
}> = {}) {
  return {
    organizationId: "org-1",
    slug: "site-1",
    version: 1,
    studioId: "studio-1",
    sessionId: "session-1",
    runId: "run-1",
    ...overrides,
  };
}

describe("StudioAgentLeaseService", () => {
  it("keeps a run active while under max lease age", () => {
    let now = 1_000;
    const service = new StudioAgentLeaseService({
      now: () => now,
      leaseTtlMs: 90_000,
      maxLeaseMs: 60_000,
    });

    const first = service.reportActive(identity());
    now += 30_000;
    const second = service.reportActive(identity());

    expect(first.leaseState).toBe<StudioAgentLeaseState>("active");
    expect(second.leaseState).toBe<StudioAgentLeaseState>("active");
    expect(second.activeRuns).toBe(1);
  });

  it("marks a run as max_exceeded and keeps it capped until idle is reported", () => {
    let now = 5_000;
    const service = new StudioAgentLeaseService({
      now: () => now,
      leaseTtlMs: 90_000,
      maxLeaseMs: 10_000,
    });

    service.reportActive(identity());
    now += 15_000;

    const exceeded = service.reportActive(identity());
    now += 5_000;
    const stillExceeded = service.reportActive(identity());

    expect(exceeded.leaseState).toBe<StudioAgentLeaseState>("max_exceeded");
    expect(stillExceeded.leaseState).toBe<StudioAgentLeaseState>("max_exceeded");

    const cleared = service.reportIdle(identity());
    expect(cleared).toEqual({ removed: true });

    const freshIdentity = identity({ runId: "run-2" });
    const fresh = service.reportActive(freshIdentity);
    expect(fresh.leaseState).toBe<StudioAgentLeaseState>("active");
  });
});
