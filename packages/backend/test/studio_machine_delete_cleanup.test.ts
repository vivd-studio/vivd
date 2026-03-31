import { describe, expect, it, vi } from "vitest";
import { cleanupManagedStudioMachinesForDeletedProject } from "../src/services/studioMachines/deleteCleanup";

describe("cleanupManagedStudioMachinesForDeletedProject", () => {
  it("destroys matching managed machines for the deleted project", async () => {
    const listStudioMachines = vi.fn().mockResolvedValue([
      {
        id: "machine-1",
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
      },
      {
        id: "machine-2",
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 2,
      },
      {
        id: "machine-3",
        organizationId: "org-1",
        projectSlug: "other-site",
        version: 1,
      },
    ]);
    const destroyStudioMachine = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const warn = vi.fn();

    const result = await cleanupManagedStudioMachinesForDeletedProject({
      provider: {
        kind: "docker",
        listStudioMachines,
        destroyStudioMachine,
      } as any,
      organizationId: "org-1",
      slug: "site-1",
      logPrefix: "Delete",
      log,
      warn,
    });

    expect(destroyStudioMachine).toHaveBeenCalledTimes(2);
    expect(destroyStudioMachine).toHaveBeenCalledWith("machine-1");
    expect(destroyStudioMachine).toHaveBeenCalledWith("machine-2");
    expect(result).toEqual({
      destroyed: 2,
      warnings: [],
    });
    expect(log).toHaveBeenCalledWith(
      "[Delete] Destroyed 2 managed studio machine(s) for: site-1",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps deletion cleanup best-effort when machine destroy fails", async () => {
    const listStudioMachines = vi.fn().mockResolvedValue([
      {
        id: "machine-1",
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
      },
      {
        id: "machine-2",
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 2,
      },
    ]);
    const destroyStudioMachine = vi
      .fn()
      .mockRejectedValueOnce(new Error("container missing"))
      .mockResolvedValueOnce(undefined);
    const warn = vi.fn();

    const result = await cleanupManagedStudioMachinesForDeletedProject({
      provider: {
        kind: "docker",
        listStudioMachines,
        destroyStudioMachine,
      } as any,
      organizationId: "org-1",
      slug: "site-1",
      logPrefix: "Delete",
      warn,
    });

    expect(destroyStudioMachine).toHaveBeenCalledTimes(2);
    expect(result.destroyed).toBe(1);
    expect(result.warnings).toEqual([
      "[Delete] Failed to destroy studio machine machine-1 for site-1/v1: container missing",
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[Delete] Failed to destroy studio machine machine-1 for site-1/v1: container missing",
    );
  });

  it("keeps deletion cleanup best-effort when machine listing fails", async () => {
    const warn = vi.fn();

    const result = await cleanupManagedStudioMachinesForDeletedProject({
      provider: {
        kind: "docker",
        listStudioMachines: vi.fn().mockRejectedValue(new Error("docker unavailable")),
        destroyStudioMachine: vi.fn(),
      } as any,
      organizationId: "org-1",
      slug: "site-1",
      version: 3,
      logPrefix: "DeleteVersion",
      warn,
    });

    expect(result).toEqual({
      destroyed: 0,
      warnings: [
        "[DeleteVersion] Failed to list managed studio machines for site-1/v3: docker unavailable",
      ],
    });
    expect(warn).toHaveBeenCalledWith(
      "[DeleteVersion] Failed to list managed studio machines for site-1/v3: docker unavailable",
    );
  });
});
