import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { Message, SessionError } from "./chatTypes";
import { sanitizeSessionError } from "./chatErrorPolicy";

type ConfirmDialogState = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type UseChatActionsArgs = {
  projectSlug: string;
  version?: number;
  onTaskComplete?: () => void;
  selectedSessionId: string | null;
  setSelectedSessionId: (sessionId: string | null) => void;
  setPendingSessionId: (sessionId: string | null) => void;
  refetchMessages: () => void;
  refetchSessions: () => void;
  isWaitingForAgent: MutableRefObject<boolean>;
  buildRunTaskPayload: (task: string, sessionId?: string | null) => any;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setIsWaiting: Dispatch<SetStateAction<boolean>>;
  setStreamingParts: Dispatch<SetStateAction<any[]>>;
  setSessionError: Dispatch<SetStateAction<SessionError | null>>;
  clearPendingRunState?: () => void;
};

export function useChatActions({
  projectSlug,
  version,
  onTaskComplete,
  selectedSessionId,
  setSelectedSessionId,
  setPendingSessionId,
  refetchMessages,
  refetchSessions,
  isWaitingForAgent,
  buildRunTaskPayload,
  setMessages,
  setIsStreaming,
  setIsWaiting,
  setStreamingParts,
  setSessionError,
  clearPendingRunState,
}: UseChatActionsArgs) {
  const confirmResolverRef = useRef<((result: boolean) => void) | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: "",
  });

  const requestConfirm = useCallback(
    (options: Omit<ConfirmDialogState, "open">) => {
      return new Promise<boolean>((resolve) => {
        confirmResolverRef.current = resolve;
        setConfirmDialog({ open: true, ...options });
      });
    },
    [],
  );

  const resolveConfirm = useCallback((result: boolean) => {
    confirmResolverRef.current?.(result);
    confirmResolverRef.current = null;
    setConfirmDialog((prev) => ({ ...prev, open: false }));
  }, []);

  const cancelConfirmIfPending = useCallback(() => {
    if (confirmResolverRef.current) {
      resolveConfirm(false);
    }
  }, [resolveConfirm]);

  const runTaskMutation = trpc.agent.runTask.useMutation({
    onSuccess: (data) => {
      if (data.sessionId) {
        if (data.sessionId !== selectedSessionId) {
          setPendingSessionId(data.sessionId);
          setSelectedSessionId(data.sessionId);
        }
        refetchSessions();
        isWaitingForAgent.current = true;
      }
    },
    onError: (error) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          content:
            "I ran into an issue and couldn't complete that request. Please try again.",
          createdAt: Date.now(),
        },
      ]);
      setSessionError(
        sanitizeSessionError({
          type: "task",
          message: error.message,
        }),
      );
      isWaitingForAgent.current = false;
      setIsStreaming(false);
      setIsWaiting(false);
      setStreamingParts([]);
      clearPendingRunState?.();
    },
  });

  const sendTask = useCallback(
    (
      task: string,
      targetSessionId: string | null,
      options?: { onSettled?: () => void },
    ) => {
      isWaitingForAgent.current = true;
      setIsStreaming(false);
      setIsWaiting(true);
      setSessionError(null);
      setStreamingParts([]);

      setMessages((prev) => [
        ...prev,
        { role: "user", content: task, createdAt: Date.now() },
      ]);
      runTaskMutation.mutate(buildRunTaskPayload(task, targetSessionId), {
        onSettled: options?.onSettled,
      });
    },
    [
      isWaitingForAgent,
      setIsStreaming,
      setIsWaiting,
      setSessionError,
      setStreamingParts,
      setMessages,
      runTaskMutation,
      buildRunTaskPayload,
    ],
  );

  const deleteSessionMutation = trpc.agent.deleteSession.useMutation({
    onSuccess: () => {
      refetchSessions();
      if (selectedSessionId) {
        setSelectedSessionId(null);
        setMessages([]);
      }
    },
  });

  const handleDeleteSession = useCallback(
    async (e: MouseEvent, sessionId: string) => {
      e.stopPropagation();
      const ok = await requestConfirm({
        title: "Delete this session?",
        description: "This will permanently delete the session and its messages.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        destructive: true,
      });
      if (!ok) return;
      await deleteSessionMutation.mutateAsync({
        sessionId,
        projectSlug,
        version,
      });
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
        setMessages([]);
      }
    },
    [
      requestConfirm,
      deleteSessionMutation,
      projectSlug,
      version,
      selectedSessionId,
      setSelectedSessionId,
      setMessages,
    ],
  );

  const revertMutation = trpc.agent.revertToMessage.useMutation({
    onSuccess: (data) => {
      refetchSessions();
      onTaskComplete?.();
      if (Array.isArray(data.trackedFiles) && data.trackedFiles.length === 0) {
        toast.info("Nothing to revert", {
          description:
            "We couldn’t find any reversible changes for that message. This can happen when changes were made outside tracked edits (for example via terminal commands).",
        });
      }
    },
    onError: (error) => {
      toast.error("Revert failed", { description: error.message });
    },
  });

  const unrevertMutation = trpc.agent.unrevertSession.useMutation({
    onSuccess: () => {
      refetchSessions();
      onTaskComplete?.();
    },
    onError: (error) => {
      toast.error("Restore failed", { description: error.message });
    },
  });

  const handleRevert = useCallback(
    async (messageId: string) => {
      if (!selectedSessionId) return;
      const ok = await requestConfirm({
        title: "Revert changes from this task?",
        description: "This will undo file changes made by the agent.",
        confirmLabel: "Revert",
        cancelLabel: "Cancel",
        destructive: true,
      });
      if (!ok) return;
      try {
        await revertMutation.mutateAsync({
          sessionId: selectedSessionId,
          messageId,
          projectSlug,
          version,
        });
      } catch {
        // Handled by mutation onError.
      }
    },
    [
      selectedSessionId,
      requestConfirm,
      revertMutation,
      projectSlug,
      version,
    ],
  );

  const handleUnrevert = useCallback(async () => {
    if (!selectedSessionId) return;
    try {
      await unrevertMutation.mutateAsync({
        sessionId: selectedSessionId,
        projectSlug,
        version,
      });
    } catch {
      // Handled by mutation onError.
    }
  }, [selectedSessionId, unrevertMutation, projectSlug, version]);

  const abortSessionMutation = trpc.agent.abortSession.useMutation({
    onSuccess: () => {
      setIsStreaming(false);
      setIsWaiting(false);
      setStreamingParts([]);
      isWaitingForAgent.current = false;
      clearPendingRunState?.();
      refetchMessages();
    },
  });

  const handleStopGeneration = useCallback(() => {
    if (!selectedSessionId) return;
    abortSessionMutation.mutate({
      sessionId: selectedSessionId,
      projectSlug,
      version,
    });
  }, [abortSessionMutation, selectedSessionId, projectSlug, version]);

  return {
    runTaskMutation,
    sendTask,
    confirmDialog,
    resolveConfirm,
    cancelConfirmIfPending,
    handleDeleteSession,
    handleRevert,
    handleUnrevert,
    handleStopGeneration,
  };
}
