import { useCallback, useRef, useState } from "react";

export type ConfirmDialogState = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export function useConfirmDialog() {
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

  return {
    confirmDialog,
    requestConfirm,
    resolveConfirm,
    cancelConfirmIfPending,
  };
}
