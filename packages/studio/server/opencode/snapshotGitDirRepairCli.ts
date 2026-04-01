import { runSnapshotGitDirRepairCli } from "./snapshotGitDirRepair.js";

const exitCode = await runSnapshotGitDirRepairCli();
if (exitCode !== 0) {
  process.exit(exitCode);
}
