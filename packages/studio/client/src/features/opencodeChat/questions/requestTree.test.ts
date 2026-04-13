import { describe, expect, it } from "vitest";
import {
  sessionPermissionRequest,
  sessionQuestionRequest,
} from "./requestTree";
import type {
  OpenCodePermissionRequest,
  OpenCodeQuestionRequest,
  OpenCodeSession,
} from "../types";

function createSession(input: { id: string; parentID?: string | null }): OpenCodeSession {
  return {
    id: input.id,
    ...(input.parentID ? { parentID: input.parentID } : {}),
  };
}

function createQuestion(
  id: string,
  sessionID: string,
): OpenCodeQuestionRequest {
  return {
    id,
    sessionID,
    questions: [],
  };
}

function createPermission(
  id: string,
  sessionID: string,
): OpenCodePermissionRequest {
  return {
    id,
    sessionID,
    permission: "bash",
    patterns: ["vivd publish deploy"],
    always: ["vivd *"],
    metadata: {},
  };
}

describe("sessionQuestionRequest", () => {
  it("prefers the current session question", () => {
    const sessions = [
      createSession({ id: "root" }),
      createSession({ id: "child", parentID: "root" }),
    ];
    const requests = {
      root: [createQuestion("q-root", "root")],
      child: [createQuestion("q-child", "child")],
    };

    expect(sessionQuestionRequest(sessions, requests, "root")?.id).toBe("q-root");
  });

  it("returns a nested child question request when the current session has none", () => {
    const sessions = [
      createSession({ id: "root" }),
      createSession({ id: "child", parentID: "root" }),
      createSession({ id: "grand", parentID: "child" }),
    ];
    const requests = {
      grand: [createQuestion("q-grand", "grand")],
    };

    expect(sessionQuestionRequest(sessions, requests, "root")?.id).toBe("q-grand");
  });
});

describe("sessionPermissionRequest", () => {
  it("returns a nested child permission request when the current session has none", () => {
    const sessions = [
      createSession({ id: "root" }),
      createSession({ id: "child", parentID: "root" }),
    ];
    const requests = {
      child: [createPermission("perm-child", "child")],
    };

    expect(sessionPermissionRequest(sessions, requests, "root")?.id).toBe(
      "perm-child",
    );
  });
});
