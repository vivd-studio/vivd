import { useCallback, useMemo, useState } from "react";

export type WorkspaceSurface =
  | { kind: "none" }
  | { kind: "cms" }
  | { kind: "text"; path: string }
  | { kind: "image"; path: string }
  | { kind: "pdf"; path: string };

export function usePreviewWorkspaceSurface() {
  const [cmsOpenState, setCmsOpenState] = useState(false);
  const [editingTextFileState, setEditingTextFileState] = useState<string | null>(null);
  const [viewingImagePathState, setViewingImagePathState] = useState<string | null>(null);
  const [viewingPdfPathState, setViewingPdfPathState] = useState<string | null>(null);
  const [workspaceHistory, setWorkspaceHistory] = useState<WorkspaceSurface[]>([]);

  const currentWorkspace = useMemo<WorkspaceSurface>(() => {
    if (editingTextFileState) {
      return { kind: "text", path: editingTextFileState };
    }
    if (viewingImagePathState) {
      return { kind: "image", path: viewingImagePathState };
    }
    if (viewingPdfPathState) {
      return { kind: "pdf", path: viewingPdfPathState };
    }
    if (cmsOpenState) {
      return { kind: "cms" };
    }
    return { kind: "none" };
  }, [
    cmsOpenState,
    editingTextFileState,
    viewingImagePathState,
    viewingPdfPathState,
  ]);

  const applyWorkspaceSurface = useCallback((surface: WorkspaceSurface) => {
    setCmsOpenState(surface.kind === "cms");
    setEditingTextFileState(surface.kind === "text" ? surface.path : null);
    setViewingImagePathState(surface.kind === "image" ? surface.path : null);
    setViewingPdfPathState(surface.kind === "pdf" ? surface.path : null);
  }, []);

  const isSameWorkspaceSurface = useCallback(
    (left: WorkspaceSurface, right: WorkspaceSurface) => {
      if (left.kind !== right.kind) return false;
      if (
        left.kind === "text" ||
        left.kind === "image" ||
        left.kind === "pdf"
      ) {
        return left.path === (right as typeof left).path;
      }
      return true;
    },
    [],
  );

  const openWorkspaceSurface = useCallback(
    (
      nextSurface: Exclude<WorkspaceSurface, { kind: "none" }>,
      mode: "root" | "push" | "replace",
    ) => {
      if (isSameWorkspaceSurface(currentWorkspace, nextSurface)) {
        if (mode === "root" && workspaceHistory.length > 0) {
          setWorkspaceHistory([]);
        }
        applyWorkspaceSurface(nextSurface);
        return;
      }

      if (mode === "root") {
        setWorkspaceHistory([]);
      } else if (mode === "push" && currentWorkspace.kind !== "none") {
        setWorkspaceHistory([...workspaceHistory, currentWorkspace]);
      }

      applyWorkspaceSurface(nextSurface);
    },
    [
      applyWorkspaceSurface,
      currentWorkspace,
      isSameWorkspaceSurface,
      workspaceHistory,
    ],
  );

  const closeWorkspaceSurface = useCallback(
    (kind: WorkspaceSurface["kind"]) => {
      if (currentWorkspace.kind !== kind) {
        return;
      }

      if (workspaceHistory.length === 0) {
        applyWorkspaceSurface({ kind: "none" });
        return;
      }

      const nextHistory = workspaceHistory.slice(0, -1);
      const previousSurface = workspaceHistory[workspaceHistory.length - 1]!;
      setWorkspaceHistory(nextHistory);
      applyWorkspaceSurface(previousSurface);
    },
    [applyWorkspaceSurface, currentWorkspace.kind, workspaceHistory],
  );

  const setCmsOpen = useCallback(
    (open: boolean) => {
      if (open) {
        openWorkspaceSurface({ kind: "cms" }, "root");
        return;
      }
      if (currentWorkspace.kind !== "cms") {
        return;
      }
      setWorkspaceHistory([]);
      applyWorkspaceSurface({ kind: "none" });
    },
    [applyWorkspaceSurface, currentWorkspace.kind, openWorkspaceSurface],
  );

  const setEditingTextFile = useCallback(
    (path: string | null) => {
      if (!path) {
        closeWorkspaceSurface("text");
        return;
      }

      const openMode =
        currentWorkspace.kind === "none"
          ? "root"
          : currentWorkspace.kind === "cms"
            ? "push"
            : "replace";
      openWorkspaceSurface({ kind: "text", path }, openMode);
    },
    [closeWorkspaceSurface, currentWorkspace.kind, openWorkspaceSurface],
  );

  const setViewingImagePath = useCallback(
    (path: string | null) => {
      if (!path) {
        closeWorkspaceSurface("image");
        return;
      }

      const openMode =
        currentWorkspace.kind === "none"
          ? "root"
          : currentWorkspace.kind === "cms"
            ? "push"
            : "replace";
      openWorkspaceSurface({ kind: "image", path }, openMode);
    },
    [closeWorkspaceSurface, currentWorkspace.kind, openWorkspaceSurface],
  );

  const setViewingPdfPath = useCallback(
    (path: string | null) => {
      if (!path) {
        closeWorkspaceSurface("pdf");
        return;
      }

      const openMode =
        currentWorkspace.kind === "none"
          ? "root"
          : currentWorkspace.kind === "cms"
            ? "push"
            : "replace";
      openWorkspaceSurface({ kind: "pdf", path }, openMode);
    },
    [closeWorkspaceSurface, currentWorkspace.kind, openWorkspaceSurface],
  );

  return {
    cmsOpenState,
    setCmsOpen,
    editingTextFileState,
    setEditingTextFile,
    viewingImagePathState,
    setViewingImagePath,
    viewingPdfPathState,
    setViewingPdfPath,
  };
}
