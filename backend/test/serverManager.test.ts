import { describe, it, expect, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import treeKill from "tree-kill";

/**
 * Tests for the serverManager process cleanup logic.
 * These tests verify that tree-kill properly kills process trees.
 */

describe("ServerManager Process Cleanup", () => {
  describe("killProcessTree behavior (via tree-kill)", () => {
    it("should kill a process and its children", async () => {
      // Spawn a parent process that spawns a child
      // This simulates opencode spawning language servers
      const parent = spawn("node", [
        "-e",
        `
        const { spawn } = require('child_process');
        // Spawn a child that runs forever
        const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'], { detached: false });
        console.log('child:' + child.pid);
        // Parent also runs forever
        setInterval(() => {}, 1000);
        `,
      ]);

      // Wait for child PID to be logged
      let childPid: number | null = null;
      await new Promise<void>((resolve) => {
        parent.stdout?.on("data", (data) => {
          const match = data.toString().match(/child:(\d+)/);
          if (match) {
            childPid = parseInt(match[1], 10);
            resolve();
          }
        });
        // Timeout after 2 seconds
        setTimeout(resolve, 2000);
      });

      expect(parent.pid).toBeDefined();
      expect(childPid).not.toBeNull();

      // Verify both processes are running
      const isRunning = (pid: number): boolean => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };

      expect(isRunning(parent.pid!)).toBe(true);
      expect(isRunning(childPid!)).toBe(true);

      // Kill the process tree
      await new Promise<void>((resolve) => {
        treeKill(parent.pid!, "SIGKILL", () => resolve());
      });

      // Give OS time to clean up
      await new Promise((r) => setTimeout(r, 100));

      // Verify both are dead
      expect(isRunning(parent.pid!)).toBe(false);
      expect(isRunning(childPid!)).toBe(false);
    });

    it("should handle already-dead processes gracefully", async () => {
      // Spawn a process that exits immediately
      const proc = spawn("node", ["-e", "process.exit(0)"]);

      // Wait for it to exit
      await new Promise<void>((resolve) => {
        proc.on("exit", () => resolve());
      });

      // tree-kill should not throw on dead process
      await new Promise<void>((resolve) => {
        treeKill(proc.pid!, "SIGKILL", (err) => {
          // Error is expected (process already dead), but shouldn't throw
          resolve();
        });
      });
    });
  });

  describe("Port recycling logic", () => {
    it("should recycle released ports", () => {
      // Simulate the port recycling logic from serverManager
      const availablePorts: number[] = [];
      let nextPort = 4096;

      const getPort = (): number => {
        if (availablePorts.length > 0) {
          return availablePorts.pop()!;
        }
        return nextPort++;
      };

      const releasePort = (port: number): void => {
        if (!availablePorts.includes(port)) {
          availablePorts.push(port);
        }
      };

      // Get first 3 ports
      const port1 = getPort();
      const port2 = getPort();
      const port3 = getPort();

      expect(port1).toBe(4096);
      expect(port2).toBe(4097);
      expect(port3).toBe(4098);
      expect(nextPort).toBe(4099);

      // Release port2
      releasePort(port2);
      expect(availablePorts).toContain(4097);

      // Next getPort should return the recycled port
      const port4 = getPort();
      expect(port4).toBe(4097);

      // Now get a fresh port
      const port5 = getPort();
      expect(port5).toBe(4099);
    });

    it("should not add duplicate ports to available pool", () => {
      const availablePorts: number[] = [];

      const releasePort = (port: number): void => {
        if (!availablePorts.includes(port)) {
          availablePorts.push(port);
        }
      };

      releasePort(4096);
      releasePort(4096);
      releasePort(4096);

      expect(availablePorts.length).toBe(1);
    });
  });
});
