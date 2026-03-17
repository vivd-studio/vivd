export function getWorkspaceDir(ctx: {
  workspace: { isInitialized(): boolean; getProjectPath(): string };
}): string {
  if (!ctx.workspace.isInitialized()) {
    throw new Error("Workspace not initialized");
  }
  return ctx.workspace.getProjectPath();
}
