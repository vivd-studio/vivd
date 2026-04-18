import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

vi.mock("../services/reporting/UsageReporter.js", () => ({
  usageReporter: {
    report: vi.fn(),
    updateSessionTitle: vi.fn(),
  },
}));

vi.mock("../services/reporting/AgentLeaseReporter.js", () => ({
  agentLeaseReporter: {
    startRun: vi.fn(),
    finishRun: vi.fn(),
    finishSession: vi.fn(),
    hasActiveSession: vi.fn(() => false),
  },
}));

vi.mock("../services/sync/AgentTaskSyncService.js", () => ({
  requestBucketSyncAfterAgentTask: vi.fn(),
}));

vi.mock("../services/agent/AgentInstructionsService.js", () => ({
  agentInstructionsService: {
    getSystemPromptForSessionStart: vi.fn(async () => undefined),
  },
}));

import {
  getSessionContent,
  revertToUserMessage,
  runTask,
  unrevertSession,
} from "./index.js";
import { agentEventEmitter } from "./eventEmitter.js";
import {
  repairOpencodeSnapshotGitDirs,
  resolveSnapshotGitDirPath,
} from "./snapshotGitDirRepair.js";
import { serverManager } from "./serverManager.js";
import { workspaceEventPump } from "./events/workspaceEventPump.js";

const RUN_REVERT_TESTS = process.env.VIVD_RUN_OPENCODE_REVERT_TESTS === "1";
const OPENCODE_VERSION = "1.4.11";

// To run inside the production-like Studio image (no network required):
// `docker build -f packages/studio/Dockerfile -t vivd-studio:test .`
// `docker run --rm -e VIVD_RUN_OPENCODE_REVERT_TESTS=1 vivd-studio:test npm run test:run -w @vivd/studio -- server/opencode/revert.integration.test.ts`

function getOpencodeVersion(): string | null {
  try {
    const res = spawnSync("opencode", ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.error) return null;
    const output = `${res.stdout || ""}\n${res.stderr || ""}`.trim();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address && "port" in address) {
          resolve(address.port);
          return;
        }
        reject(new Error("Could not determine free port"));
      });
    });
  });
}

async function waitForOpencodeReady(url: string, timeoutMs = 120_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1_000);
      const response = await fetch(`${url}/config`, { signal: controller.signal });
      clearTimeout(timeout);
      // We don't care about the payload — any HTTP response means the server is accepting requests.
      void response.body?.cancel?.();
      return;
    } catch {
      // Retry.
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`Timed out waiting for OpenCode server at ${url}`);
}

async function waitForSessionToSettle(options: {
  client: ReturnType<typeof createOpencodeClient>;
  sessionId: string;
  directory: string;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let sawBusy = false;
  let sawUserMessage = false;
  let sawAssistantMessage = false;

  const events = await options.client.event.subscribe(
    { directory: options.directory },
    { signal: controller.signal } as any,
  );

  const getEventSessionId = (event: any): string | undefined =>
    event?.properties?.sessionID ??
    event?.properties?.info?.sessionID ??
    event?.properties?.part?.sessionID;

  try {
    for await (const event of events.stream) {
      if (getEventSessionId(event) !== options.sessionId) {
        continue;
      }

      if (event.type === "message.updated") {
        const role = (event.properties as any)?.info?.role;
        if (role === "user") {
          sawUserMessage = true;
        } else if (role === "assistant") {
          sawAssistantMessage = true;
        }
        continue;
      }

      if (event.type === "session.status") {
        const type = (event.properties as any)?.status?.type;
        if (type === "busy") {
          sawBusy = true;
        }
        if (
          (type === "idle" || type === "done") &&
          (sawBusy || (sawUserMessage && sawAssistantMessage))
        ) {
          return;
        }
        continue;
      }

      if (
        event.type === "session.idle" &&
        (sawBusy || (sawUserMessage && sawAssistantMessage))
      ) {
        return;
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }

  throw new Error(
    `Timed out waiting for session ${options.sessionId} to settle after promptAsync`,
  );
}

async function waitForStudioSessionCompletion(
  sessionId: string,
  timeoutMs = 120_000,
): Promise<void> {
  if (agentEventEmitter.isSessionCompleted(sessionId)) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for await (const event of agentEventEmitter.createSessionStream(
      sessionId,
      controller.signal,
    )) {
      if (event.type === "session.completed") {
        return;
      }

      if (event.type === "session.error") {
        const error = event.data as {
          errorType?: string;
          message?: string;
        };
        throw new Error(
          `Studio session failed: ${error.errorType || "error"}: ${error.message || "Unknown error"}`,
        );
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }

  if (agentEventEmitter.isSessionCompleted(sessionId)) {
    return;
  }

  throw new Error(`Timed out waiting for Studio session ${sessionId} to complete`);
}

async function killProcess(proc: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (proc.exitCode !== null) return;

  proc.kill("SIGTERM");

  const startedAt = Date.now();
  while (proc.exitCode === null && Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }

  if (proc.exitCode === null) {
    proc.kill("SIGKILL");
  }
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("git", args, { cwd, stdio: "ignore" });
    proc.once("error", reject);
    proc.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args.join(" ")} failed (code=${code})`));
    });
  });
}

type OpencodeServer = { url: string; proc: ChildProcess };

async function spawnOpencodeServer(options: {
  repoDir: string;
  homeDir: string;
}): Promise<OpencodeServer> {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;

  const systemVersion = getOpencodeVersion();
  const useSystemOpencode = systemVersion === OPENCODE_VERSION;

  const proc = spawn(
    useSystemOpencode
      ? "opencode"
      : process.platform === "win32"
        ? "npx.cmd"
        : "npx",
    useSystemOpencode
      ? ["serve", "--port", String(port)]
      : ["-y", `opencode-ai@${OPENCODE_VERSION}`, "serve", "--port", String(port)],
    {
      cwd: options.repoDir,
      env: {
        ...process.env,
        HOME: options.homeDir,
        XDG_CONFIG_HOME: path.join(options.homeDir, ".config"),
        XDG_DATA_HOME: path.join(options.homeDir, ".local", "share"),
        OPENCODE_PROJECT_DIR: options.repoDir,
        // Keep tests hermetic/offline: disable default plugin downloads.
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [] }),
      },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );

  await waitForOpencodeReady(url);
  return { url, proc };
}

async function copyOpencodePersistedState(options: {
  fromHomeDir: string;
  toHomeDir: string;
  repoDir: string;
}): Promise<void> {
  const fromDataDir = path.join(
    options.fromHomeDir,
    ".local",
    "share",
    "opencode",
  );
  const toDataDir = path.join(
    options.toHomeDir,
    ".local",
    "share",
    "opencode",
  );

  await fs.mkdir(toDataDir, { recursive: true });

  for (const filename of ["opencode.db", "opencode.db-shm", "opencode.db-wal"]) {
    await fs
      .copyFile(path.join(fromDataDir, filename), path.join(toDataDir, filename))
      .catch(() => undefined);
  }

  await fs.mkdir(path.join(toDataDir, "storage"), { recursive: true });
  await fs
    .cp(
      path.join(fromDataDir, "storage", "session_diff"),
      path.join(toDataDir, "storage", "session_diff"),
      { recursive: true },
    )
    .catch(() => undefined);

  await fs
    .cp(path.join(fromDataDir, "snapshot"), path.join(toDataDir, "snapshot"), {
      recursive: true,
    })
    .catch(() => undefined);

  const toSnapshotDir = path.join(toDataDir, "snapshot");
  const snapshotEntries = await fs
    .readdir(toSnapshotDir, { withFileTypes: true })
    .catch(() => [] as Dirent[]);
  for (const entry of snapshotEntries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(toSnapshotDir, entry.name);
    const nestedEntries = await fs
      .readdir(projectDir, { withFileTypes: true })
      .catch(() => [] as Dirent[]);
    const candidates = [projectDir];
    for (const nestedEntry of nestedEntries) {
      if (!nestedEntry.isDirectory()) continue;
      candidates.push(path.join(projectDir, nestedEntry.name));
    }

    for (const repoDir of candidates) {
      const isGitDir = await fs
        .stat(path.join(repoDir, "HEAD"))
        .then((stat) => stat.isFile())
        .catch(() => false);
      if (!isGitDir) continue;

      await fs.rm(path.join(repoDir, "refs"), { recursive: true, force: true });
      await fs.rm(path.join(repoDir, "branches"), { recursive: true, force: true });
    }
  }
  await repairOpencodeSnapshotGitDirs(toSnapshotDir, options.repoDir);
}

function setOpencodeHomeEnv(homeDir: string) {
  process.env.HOME = homeDir;
  process.env.XDG_CONFIG_HOME = path.join(homeDir, ".config");
  process.env.XDG_DATA_HOME = path.join(homeDir, ".local", "share");
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ plugin: [] });
}

async function stopStudioOpencodeForRepo(repoDir: string): Promise<void> {
  workspaceEventPump.stop(repoDir);
  await serverManager.stopServer(repoDir).catch(() => undefined);
}

async function readOpencodeProjectId(repoDir: string): Promise<string> {
  return (
    await fs.readFile(path.join(repoDir, ".git", "opencode"), "utf-8")
  ).trim();
}

async function breakSnapshotObjects(
  snapshotRoot: string,
  projectId: string,
  directory: string,
): Promise<void> {
  const worktreeResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: directory,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (worktreeResult.status !== 0) {
    throw new Error(
      worktreeResult.stderr ||
        worktreeResult.stdout ||
        "Failed to resolve git worktree for snapshot test",
    );
  }
  const worktree = (worktreeResult.stdout || "").trim();
  const snapshotGitDir = resolveSnapshotGitDirPath(snapshotRoot, projectId, worktree);
  await fs.rm(path.join(snapshotGitDir, "objects"), {
    recursive: true,
    force: true,
  });
  await fs.mkdir(path.join(snapshotGitDir, "objects", "info"), { recursive: true });
  await fs.mkdir(path.join(snapshotGitDir, "objects", "pack"), { recursive: true });
}

describe("OpenCode revert/unrevert integration", () => {
  it.skipIf(!RUN_REVERT_TESTS)(
    "reverts + unreverts tracked patch edits after async completion, restart, and rehydration to a new home",
    { timeout: 180_000 },
    async () => {
      const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-opencode-revert-"));
      const homeDir = path.join(tmpRoot, "home");
      const rehydratedHomeDir = path.join(tmpRoot, "rehydrated-home");
      const repoDir = path.join(tmpRoot, "repo");
      await fs.mkdir(homeDir, { recursive: true });
      await fs.mkdir(rehydratedHomeDir, { recursive: true });
      await fs.mkdir(repoDir, { recursive: true });

      const filePath = path.join(repoDir, "foo.txt");
      await fs.writeFile(filePath, "BEFORE\n", "utf-8");

      await runGit(repoDir, ["init"]);
      await runGit(repoDir, ["config", "user.email", "test@vivd.local"]);
      await runGit(repoDir, ["config", "user.name", "Vivd Test"]);
      try {
        await runGit(repoDir, ["branch", "-M", "main"]);
      } catch {
        // Best-effort only (git versions can differ).
      }
      await runGit(repoDir, ["add", "-A"]);
      await runGit(repoDir, ["commit", "-m", "init"]);

      let server: OpencodeServer | null = null;
      let sessionId: string;
      let userMessageId: string;

      try {
        server = await spawnOpencodeServer({ repoDir, homeDir });
        const client = createOpencodeClient({ baseUrl: server.url, directory: repoDir });
        let editedContent: string;

        const sessionRes = await client.session.create({ directory: repoDir });
        expect(sessionRes.error).toBeUndefined();
        sessionId = sessionRes.data!.id;

        const promptRes = await client.session.promptAsync({
          sessionID: sessionId,
          directory: repoDir,
          model: { providerID: "opencode", modelID: "big-pickle" },
          parts: [
            {
              type: "text",
              text: "Edit foo.txt so its entire contents are exactly: AFTER\\n",
            },
          ],
        });

        expect(promptRes.error).toBeUndefined();
        await waitForSessionToSettle({
          client,
          sessionId,
          directory: repoDir,
        });
        editedContent = await fs.readFile(filePath, "utf-8");
        expect(editedContent.trim()).toBe("AFTER");

        const messagesRes = await client.session.messages({
          sessionID: sessionId,
          directory: repoDir,
        });
        expect(messagesRes.error).toBeUndefined();

        userMessageId = messagesRes.data!.find((m) => m.info.role === "user")!.info.id;

        const diffRes = await client.session.diff({
          sessionID: sessionId,
          directory: repoDir,
          messageID: userMessageId,
        });
        expect(diffRes.error).toBeUndefined();
        expect((diffRes.data ?? []).some((d) => d.file === "foo.txt")).toBe(true);

        const revertRes = await client.session.revert({
          sessionID: sessionId,
          directory: repoDir,
          messageID: userMessageId,
        });
        expect(revertRes.error).toBeUndefined();
        expect(await fs.readFile(filePath, "utf-8")).toBe("BEFORE\n");

        const unrevertRes = await client.session.unrevert({
          sessionID: sessionId,
          directory: repoDir,
        });
        expect(unrevertRes.error).toBeUndefined();
        expect(await fs.readFile(filePath, "utf-8")).toBe(editedContent);

        await killProcess(server.proc);
        server = await spawnOpencodeServer({ repoDir, homeDir });

        const client2 = createOpencodeClient({ baseUrl: server.url, directory: repoDir });

        const revertRes2 = await client2.session.revert({
          sessionID: sessionId,
          directory: repoDir,
          messageID: userMessageId,
        });
        expect(revertRes2.error).toBeUndefined();
        expect(await fs.readFile(filePath, "utf-8")).toBe("BEFORE\n");

        const unrevertRes2 = await client2.session.unrevert({
          sessionID: sessionId,
          directory: repoDir,
        });
        expect(unrevertRes2.error).toBeUndefined();
        expect(await fs.readFile(filePath, "utf-8")).toBe(editedContent);

        await killProcess(server.proc);
        await copyOpencodePersistedState({
          fromHomeDir: homeDir,
          toHomeDir: rehydratedHomeDir,
          repoDir,
        });
        server = await spawnOpencodeServer({
          repoDir,
          homeDir: rehydratedHomeDir,
        });

        const client3 = createOpencodeClient({ baseUrl: server.url, directory: repoDir });

        const revertRes3 = await client3.session.revert({
          sessionID: sessionId,
          directory: repoDir,
          messageID: userMessageId,
        });
        expect(revertRes3.error).toBeUndefined();
        expect(await fs.readFile(filePath, "utf-8")).toBe("BEFORE\n");

        const unrevertRes3 = await client3.session.unrevert({
          sessionID: sessionId,
          directory: repoDir,
        });
        expect(unrevertRes3.error).toBeUndefined();
        expect(await fs.readFile(filePath, "utf-8")).toBe(editedContent);
      } finally {
        if (server) await killProcess(server.proc);
      }
    },
  );

  it.skipIf(!RUN_REVERT_TESTS)(
    "runs through the Studio wrapper for same-session revert/unrevert and again after restart + rehydration",
    { timeout: 240_000 },
    async () => {
      const originalEnv = {
        HOME: process.env.HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        XDG_DATA_HOME: process.env.XDG_DATA_HOME,
        OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT,
      };
      const tmpRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "vivd-studio-opencode-revert-"),
      );
      const homeDir = path.join(tmpRoot, "home");
      const rehydratedHomeDir = path.join(tmpRoot, "rehydrated-home");
      const repoDir = path.join(tmpRoot, "repo");
      await fs.mkdir(homeDir, { recursive: true });
      await fs.mkdir(rehydratedHomeDir, { recursive: true });
      await fs.mkdir(repoDir, { recursive: true });

      const filePath = path.join(repoDir, "foo.txt");
      await fs.writeFile(filePath, "BEFORE\n", "utf-8");

      await runGit(repoDir, ["init"]);
      await runGit(repoDir, ["config", "user.email", "test@vivd.local"]);
      await runGit(repoDir, ["config", "user.name", "Vivd Test"]);
      try {
        await runGit(repoDir, ["branch", "-M", "main"]);
      } catch {
        // Best-effort only.
      }
      await runGit(repoDir, ["add", "-A"]);
      await runGit(repoDir, ["commit", "-m", "init"]);

      let sessionId = "";
      let userMessageId = "";
      let editedContent = "";

      try {
        setOpencodeHomeEnv(homeDir);

        const run = await runTask(
          "Edit foo.txt so its entire contents are exactly: AFTER\\n",
          repoDir,
          undefined,
          { provider: "opencode", modelId: "big-pickle" },
        );
        sessionId = run.sessionId;
        await waitForStudioSessionCompletion(sessionId);

        editedContent = await fs.readFile(filePath, "utf-8");
        expect(editedContent.trim()).toBe("AFTER");

        const messages = await getSessionContent(sessionId, repoDir);
        const userMessage = messages.find((message) => message.info.role === "user");
        expect(userMessage).toBeTruthy();
        userMessageId = userMessage!.info.id;

        const patchParts = messages.flatMap((message) =>
          (message.parts ?? []).filter((part) => part?.type === "patch"),
        );
        expect(patchParts.length).toBeGreaterThan(0);

        const revertResult = await revertToUserMessage(
          sessionId,
          userMessageId,
          repoDir,
        );
        expect(revertResult.reverted).toBe(true);
        expect(await fs.readFile(filePath, "utf-8")).toBe("BEFORE\n");

        await unrevertSession(sessionId, repoDir);
        expect(await fs.readFile(filePath, "utf-8")).toBe(editedContent);

        await stopStudioOpencodeForRepo(repoDir);

        const revertResultAfterRestart = await revertToUserMessage(
          sessionId,
          userMessageId,
          repoDir,
        );
        expect(revertResultAfterRestart.reverted).toBe(true);
        expect(await fs.readFile(filePath, "utf-8")).toBe("BEFORE\n");

        await unrevertSession(sessionId, repoDir);
        expect(await fs.readFile(filePath, "utf-8")).toBe(editedContent);

        await stopStudioOpencodeForRepo(repoDir);
        await copyOpencodePersistedState({
          fromHomeDir: homeDir,
          toHomeDir: rehydratedHomeDir,
          repoDir,
        });
        setOpencodeHomeEnv(rehydratedHomeDir);

        const revertResultAfterRehydrate = await revertToUserMessage(
          sessionId,
          userMessageId,
          repoDir,
        );
        expect(revertResultAfterRehydrate.reverted).toBe(true);
        expect(await fs.readFile(filePath, "utf-8")).toBe("BEFORE\n");

        await unrevertSession(sessionId, repoDir);
        expect(await fs.readFile(filePath, "utf-8")).toBe(editedContent);
      } finally {
        await stopStudioOpencodeForRepo(repoDir);

        if (originalEnv.HOME == null) delete process.env.HOME;
        else process.env.HOME = originalEnv.HOME;
        if (originalEnv.XDG_CONFIG_HOME == null) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME;
        if (originalEnv.XDG_DATA_HOME == null) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = originalEnv.XDG_DATA_HOME;
        if (originalEnv.OPENCODE_CONFIG_CONTENT == null) {
          delete process.env.OPENCODE_CONFIG_CONTENT;
        } else {
          process.env.OPENCODE_CONFIG_CONTENT =
            originalEnv.OPENCODE_CONFIG_CONTENT;
        }
      }
    },
  );

  it.skipIf(!RUN_REVERT_TESTS)(
    "keeps future tracking working after rehydrate even when older snapshot history is unrecoverable",
    { timeout: 240_000 },
    async () => {
      const originalEnv = {
        HOME: process.env.HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        XDG_DATA_HOME: process.env.XDG_DATA_HOME,
        OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT,
      };
      const tmpRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "vivd-studio-opencode-old-revert-"),
      );
      const homeDir = path.join(tmpRoot, "home");
      const rehydratedHomeDir = path.join(tmpRoot, "rehydrated-home");
      const repoDir = path.join(tmpRoot, "repo");
      await fs.mkdir(homeDir, { recursive: true });
      await fs.mkdir(rehydratedHomeDir, { recursive: true });
      await fs.mkdir(repoDir, { recursive: true });

      const filePath = path.join(repoDir, "foo.txt");
      await fs.writeFile(filePath, "BEFORE\n", "utf-8");

      await runGit(repoDir, ["init"]);
      await runGit(repoDir, ["config", "user.email", "test@vivd.local"]);
      await runGit(repoDir, ["config", "user.name", "Vivd Test"]);
      try {
        await runGit(repoDir, ["branch", "-M", "main"]);
      } catch {
        // Best-effort only.
      }
      await runGit(repoDir, ["add", "-A"]);
      await runGit(repoDir, ["commit", "-m", "init"]);

      let firstSessionId = "";
      let firstUserMessageId = "";

      try {
        setOpencodeHomeEnv(homeDir);

        const firstRun = await runTask(
          "Edit foo.txt so its entire contents are exactly: AFTER_ONE\\n",
          repoDir,
          undefined,
          { provider: "opencode", modelId: "big-pickle" },
        );
        firstSessionId = firstRun.sessionId;
        await waitForStudioSessionCompletion(firstSessionId);
        expect(await fs.readFile(filePath, "utf-8")).toBe("AFTER_ONE\n");

        const firstMessages = await getSessionContent(firstSessionId, repoDir);
        const firstUserMessage = firstMessages.find(
          (message) => message.info.role === "user",
        );
        expect(firstUserMessage).toBeTruthy();
        firstUserMessageId = firstUserMessage!.info.id;
        expect(
          firstMessages.flatMap((message) =>
            (message.parts ?? []).filter((part) => part?.type === "patch"),
          ).length,
        ).toBeGreaterThan(0);

        await stopStudioOpencodeForRepo(repoDir);
        await copyOpencodePersistedState({
          fromHomeDir: homeDir,
          toHomeDir: rehydratedHomeDir,
          repoDir,
        });

        const rehydratedSnapshotRoot = path.join(
          rehydratedHomeDir,
          ".local",
          "share",
          "opencode",
          "snapshot",
        );
        const projectId = await readOpencodeProjectId(repoDir);
        await breakSnapshotObjects(rehydratedSnapshotRoot, projectId, repoDir);
        await repairOpencodeSnapshotGitDirs(rehydratedSnapshotRoot, repoDir);

        setOpencodeHomeEnv(rehydratedHomeDir);

        const failedOldRevert = await revertToUserMessage(
          firstSessionId,
          firstUserMessageId,
          repoDir,
        );
        expect(failedOldRevert).toMatchObject({
          reverted: false,
          reason: "missing_snapshot_history",
          messageId: firstUserMessageId,
        });
        expect(failedOldRevert.trackedFiles).toHaveLength(1);
        expect(failedOldRevert.trackedFiles[0]).toMatch(/\/foo\.txt$/);
        expect(await fs.readFile(filePath, "utf-8")).toBe("AFTER_ONE\n");

        const secondRun = await runTask(
          "Edit foo.txt so its entire contents are exactly: AFTER_TWO\\n",
          repoDir,
          undefined,
          { provider: "opencode", modelId: "big-pickle" },
        );
        await waitForStudioSessionCompletion(secondRun.sessionId);
        expect(await fs.readFile(filePath, "utf-8")).toBe("AFTER_TWO\n");

        const secondMessages = await getSessionContent(secondRun.sessionId, repoDir);
        expect(
          secondMessages.flatMap((message) =>
            (message.parts ?? []).filter((part) => part?.type === "patch"),
          ).length,
        ).toBeGreaterThan(0);
      } finally {
        await stopStudioOpencodeForRepo(repoDir);

        if (originalEnv.HOME == null) delete process.env.HOME;
        else process.env.HOME = originalEnv.HOME;
        if (originalEnv.XDG_CONFIG_HOME == null) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME;
        if (originalEnv.XDG_DATA_HOME == null) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = originalEnv.XDG_DATA_HOME;
        if (originalEnv.OPENCODE_CONFIG_CONTENT == null) {
          delete process.env.OPENCODE_CONFIG_CONTENT;
        } else {
          process.env.OPENCODE_CONFIG_CONTENT =
            originalEnv.OPENCODE_CONFIG_CONTENT;
        }
      }
    },
  );
});
