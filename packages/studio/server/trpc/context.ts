import type { WorkspaceManager } from "../workspace/WorkspaceManager.js";

export interface Context {
  workspace: WorkspaceManager;
}

export function createContext(workspace: WorkspaceManager): Context {
  return { workspace };
}
