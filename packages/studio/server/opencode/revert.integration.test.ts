import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createOpencodeClient } from "@opencode-ai/sdk";

const RUN_REVERT_TESTS = process.env.VIVD_RUN_OPENCODE_REVERT_TESTS === "1";
const OPENCODE_VERSION = "1.1.65";

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

describe("OpenCode revert/unrevert integration", () => {
  it.skipIf(!RUN_REVERT_TESTS)(
    "reverts + unreverts tracked patch edits (even after server restart)",
    { timeout: 180_000 },
    async () => {
      const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-opencode-revert-"));
      const homeDir = path.join(tmpRoot, "home");
      const repoDir = path.join(tmpRoot, "repo");
      await fs.mkdir(homeDir, { recursive: true });
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

        const sessionRes = await client.session.create({ query: { directory: repoDir } });
        expect(sessionRes.error).toBeUndefined();
        sessionId = sessionRes.data!.id;

        const promptRes = await client.session.prompt({
          path: { id: sessionId },
          query: { directory: repoDir },
          body: {
            model: { providerID: "opencode", modelID: "big-pickle" },
            parts: [
              {
                type: "text",
                text: "Edit foo.txt so its entire contents are exactly: AFTER\\n",
              },
            ],
          },
        });

        expect(promptRes.error).toBeUndefined();
        expect(await fs.readFile(filePath, "utf-8")).toBe("AFTER\n");

        const messagesRes = await client.session.messages({
          path: { id: sessionId },
          query: { directory: repoDir },
        });
        expect(messagesRes.error).toBeUndefined();

        userMessageId = messagesRes.data!.find((m) => m.info.role === "user")!.info.id;

        const diffRes = await client.session.diff({
          path: { id: sessionId },
          query: { directory: repoDir, messageID: userMessageId },
        });
        expect(diffRes.error).toBeUndefined();
        expect((diffRes.data ?? []).some((d) => d.file === "foo.txt")).toBe(true);

        const revertRes = await client.session.revert({
          path: { id: sessionId },
          query: { directory: repoDir },
          body: { messageID: userMessageId },
        });
        expect(revertRes.error).toBeUndefined();
        expect(await fs.readFile(filePath, "utf-8")).toBe("BEFORE\n");

        const unrevertRes = await client.session.unrevert({
          path: { id: sessionId },
          query: { directory: repoDir },
        });
        expect(unrevertRes.error).toBeUndefined();
        expect(await fs.readFile(filePath, "utf-8")).toBe("AFTER\n");

        await killProcess(server.proc);
        server = await spawnOpencodeServer({ repoDir, homeDir });

        const client2 = createOpencodeClient({ baseUrl: server.url, directory: repoDir });

        const revertRes2 = await client2.session.revert({
          path: { id: sessionId },
          query: { directory: repoDir },
          body: { messageID: userMessageId },
        });
        expect(revertRes2.error).toBeUndefined();
        expect(await fs.readFile(filePath, "utf-8")).toBe("BEFORE\n");

        const unrevertRes2 = await client2.session.unrevert({
          path: { id: sessionId },
          query: { directory: repoDir },
        });
        expect(unrevertRes2.error).toBeUndefined();
        expect(await fs.readFile(filePath, "utf-8")).toBe("AFTER\n");
      } finally {
        if (server) await killProcess(server.proc);
      }
    },
  );
});
