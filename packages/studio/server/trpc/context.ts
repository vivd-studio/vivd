import type express from "express";
import type { WorkspaceManager } from "../workspace/WorkspaceManager.js";

export interface Context {
  workspace: WorkspaceManager;
  req?: express.Request;
  res?: express.Response;
}

export function createContext(
  workspace: WorkspaceManager,
  req?: express.Request,
  res?: express.Response,
): Context {
  return { workspace, req, res };
}
