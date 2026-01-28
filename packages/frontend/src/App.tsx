import { BrowserRouter } from "react-router-dom";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { formatDocumentTitle } from "@/lib/brand";
import { Toaster } from "@/components/ui/sonner";
import { CenteredLoading } from "@/components/common";
import { AppRoutes } from "@/app/router";

export default function App() {
  const { isPending: isSessionPending } = authClient.useSession();

  useEffect(() => {
    document.title = formatDocumentTitle();
  }, []);

  const {
    data: hasUsersData,
    isLoading: isHasUsersLoading,
    isError,
    error,
  } = trpc.user.hasUsers.useQuery();

  if (isSessionPending || isHasUsersLoading) {
    return <CenteredLoading fullScreen />;
  }

  if (isError) {
    return (
      <div className="p-4 text-red-500">
        Error checking system status. Please check console and backend logs.{" "}
        {String(error)}
      </div>
    );
  }

  const hasUsers = hasUsersData?.hasUsers ?? false;

  return (
    <BrowserRouter>
      <AppRoutes hasUsers={hasUsers} />
      <Toaster />
    </BrowserRouter>
  );
}
