import { execa } from "execa";

async function configureGitIdentity(cwd: string) {
  await execa("git", ["config", "user.email", "vivd@local"], { cwd });
  await execa("git", ["config", "user.name", "Vivd"], { cwd });
}

async function hasGitRepository(cwd: string): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--git-dir"], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function hasHeadCommit(cwd: string): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--verify", "HEAD"], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize a git repository in the specified directory and commit all files.
 * @param cwd Directory to initialize git in
 * @param message Commit message
 */
export async function initializeGitRepository(
  cwd: string,
  message: string = "Initial generation"
) {
  try {
    await execa("git", ["init"], { cwd });
    await execa("git", ["branch", "-M", "main"], { cwd });

    // Configure git user for commits (required in containers / CI).
    await configureGitIdentity(cwd);

    await execa("git", ["add", "-A"], { cwd });
    await execa("git", ["commit", "-m", message], { cwd });
    return true;
  } catch (error) {
    // Re-throw so caller can handle/log consistent with their context
    throw error;
  }
}

/**
 * Ensure the directory has a git repository with a real HEAD commit.
 * This covers both fresh directories and repos that were initialized without
 * an initial commit.
 */
export async function ensureGitRepositoryHasInitialCommit(
  cwd: string,
  message: string = "Initial generation"
) {
  if (!(await hasGitRepository(cwd))) {
    await execa("git", ["init"], { cwd });
    await execa("git", ["branch", "-M", "main"], { cwd });
  }

  await configureGitIdentity(cwd);

  if (await hasHeadCommit(cwd)) {
    return false;
  }

  await execa("git", ["branch", "-M", "main"], { cwd }).catch(() => undefined);
  await execa("git", ["add", "-A"], { cwd });
  await execa("git", ["commit", "--allow-empty", "-m", message], { cwd });
  return true;
}
