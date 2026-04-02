import { simpleGit } from "simple-git";

const WORKING_COMMIT_MARKER = ".vivd-working-commit";
const INITIAL_GENERATION_COMMIT_MESSAGE = "Complete initial generation";

export type InitialGenerationSnapshotResult = {
  commitHash: string | null;
  createdCommit: boolean;
};

async function getHeadCommitHash(workspaceDir: string): Promise<string | null> {
  const git = simpleGit(workspaceDir);
  git.env({ ...process.env, GIT_TERMINAL_PROMPT: "0" });

  try {
    const head = await git.revparse(["HEAD"]);
    const normalized = head.trim();
    return normalized || null;
  } catch {
    return null;
  }
}

export async function saveInitialGenerationSnapshot(
  workspaceDir: string,
): Promise<InitialGenerationSnapshotResult> {
  const git = simpleGit(workspaceDir);
  git.env({ ...process.env, GIT_TERMINAL_PROMPT: "0" });

  await git.addConfig("user.email", "studio@vivd.dev");
  await git.addConfig("user.name", "Vivd Studio");

  await git.raw(["add", "-A"]);

  try {
    await git.raw(["reset", "HEAD", WORKING_COMMIT_MARKER]);
  } catch {
    // Ignore if the marker is missing or not staged.
  }

  const staged = await git.raw(["diff", "--cached", "--name-only"]);
  if (!staged.trim()) {
    return {
      commitHash: await getHeadCommitHash(workspaceDir),
      createdCommit: false,
    };
  }

  const result = await git.commit(INITIAL_GENERATION_COMMIT_MESSAGE);
  return {
    commitHash: result.commit || (await getHeadCommitHash(workspaceDir)),
    createdCommit: Boolean(result.commit),
  };
}
