import { execa } from "execa";

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
    await execa("git", ["config", "user.email", "vivd@local"], { cwd });
    await execa("git", ["config", "user.name", "Vivd"], { cwd });

    await execa("git", ["add", "-A"], { cwd });
    await execa("git", ["commit", "-m", message], { cwd });
    return true;
  } catch (error) {
    // Re-throw so caller can handle/log consistent with their context
    throw error;
  }
}
