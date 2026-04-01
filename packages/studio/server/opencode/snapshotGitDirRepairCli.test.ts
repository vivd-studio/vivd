import { describe, expect, it, vi } from "vitest";
import { runSnapshotGitDirRepairCli } from "./snapshotGitDirRepair.js";

describe("runSnapshotGitDirRepairCli", () => {
  it("returns a usage error when no snapshot root is provided", async () => {
    const io = {
      log: vi.fn(),
      error: vi.fn(),
    };

    const exitCode = await runSnapshotGitDirRepairCli({
      argv: ["node", "snapshotGitDirRepairCli.js"],
      io,
    });

    expect(exitCode).toBe(1);
    expect(io.error).toHaveBeenCalledWith(
      "Usage: node snapshotGitDirRepairCli.js <snapshot-root> [directory]",
    );
    expect(io.log).not.toHaveBeenCalled();
  });

  it("runs snapshot repair and reports the result", async () => {
    const io = {
      log: vi.fn(),
      error: vi.fn(),
    };
    const repair = vi.fn().mockResolvedValue({
      repaired: ["/tmp/snapshot/project/hash"],
      rebuilt: ["/tmp/snapshot/project/hash"],
    });

    const exitCode = await runSnapshotGitDirRepairCli({
      argv: ["node", "snapshotGitDirRepairCli.js", "/tmp/snapshot", "/tmp/worktree"],
      io,
      repair,
    });

    expect(exitCode).toBe(0);
    expect(repair).toHaveBeenCalledWith("/tmp/snapshot", "/tmp/worktree");
    expect(io.log).toHaveBeenCalledWith(
      "[OpenCode] Repaired snapshot git directories: 1 (rebuilt 1)",
    );
    expect(io.error).not.toHaveBeenCalled();
  });

  it("returns a failure code when repair throws", async () => {
    const io = {
      log: vi.fn(),
      error: vi.fn(),
    };
    const error = new Error("boom");

    const exitCode = await runSnapshotGitDirRepairCli({
      argv: ["node", "snapshotGitDirRepairCli.js", "/tmp/snapshot"],
      io,
      repair: vi.fn().mockRejectedValue(error),
    });

    expect(exitCode).toBe(1);
    expect(io.error).toHaveBeenCalledWith(
      "[OpenCode] Failed to repair snapshot git directories:",
      error,
    );
    expect(io.log).not.toHaveBeenCalled();
  });
});
