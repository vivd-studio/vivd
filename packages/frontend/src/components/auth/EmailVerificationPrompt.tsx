import { useEffect, useMemo, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { ROUTES } from "@/app/router/paths";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@vivd/ui";

import { toast } from "sonner";

const VERIFICATION_PROMPT_STORAGE_KEY_PREFIX = "vivd:email-verification-prompt-seen";

function isVerificationPromptEnabled(): boolean {
  const raw = (import.meta.env.VITE_EMAIL_VERIFICATION_PROMPT_ENABLED || "")
    .toString()
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getPromptStorageKey(userId: string): string {
  return `${VERIFICATION_PROMPT_STORAGE_KEY_PREFIX}:${userId}`;
}

export function EmailVerificationPrompt() {
  const { data: session } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const promptEnabled = useMemo(isVerificationPromptEnabled, []);

  const userId = session?.user?.id ?? "";
  const userEmail = session?.user?.email ?? "";
  const emailVerified = Boolean(session?.user?.emailVerified);

  useEffect(() => {
    if (!promptEnabled || !userId) {
      setOpen(false);
      return;
    }

    if (emailVerified) {
      try {
        localStorage.removeItem(getPromptStorageKey(userId));
      } catch {
        // Ignore storage failures.
      }
      setOpen(false);
      return;
    }

    try {
      const hasSeenPrompt = localStorage.getItem(getPromptStorageKey(userId)) === "1";
      setOpen(!hasSeenPrompt);
    } catch {
      // If storage is unavailable, fall back to showing once per page load.
      setOpen(true);
    }
  }, [emailVerified, promptEnabled, userId]);

  const dismissPrompt = () => {
    if (userId) {
      try {
        localStorage.setItem(getPromptStorageKey(userId), "1");
      } catch {
        // Ignore storage failures.
      }
    }
    setOpen(false);
  };

  const handleSendVerificationEmail = async () => {
    if (!userEmail) {
      toast.error("Missing email address", {
        description: "Unable to send a verification email for this account.",
      });
      return;
    }

    setIsSending(true);
    try {
      const result = await authClient.sendVerificationEmail({
        email: userEmail,
        callbackURL: `${window.location.origin}${ROUTES.DASHBOARD}`,
      });

      if (result.error) {
        toast.error("Failed to send verification email", {
          description: result.error.message || "Please try again.",
        });
        return;
      }

      toast.success("Verification email sent", {
        description: "Please check your inbox.",
      });
    } finally {
      setIsSending(false);
    }
  };

  if (!promptEnabled || !session?.user || emailVerified) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          dismissPrompt();
          return;
        }
        setOpen(true);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify your email address</DialogTitle>
          <DialogDescription>
            Your account email is currently unverified. Verify it now to improve
            account security and recovery.
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{userEmail}</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={dismissPrompt}>
            Not now
          </Button>
          <Button
            type="button"
            onClick={handleSendVerificationEmail}
            disabled={isSending}
          >
            {isSending ? "Sending..." : "Send verification email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
