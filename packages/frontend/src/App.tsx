import { BrowserRouter, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { getRouteDocumentTitle } from "@/lib/brand";
import { Toaster } from "@/components/ui/sonner";
import { CenteredLoading } from "@/components/common";
import { AppRoutes } from "@/app/router";
import { RouteTransitionLoading } from "@/app/router/RouteTransitionLoading";

function DocumentTitleManager() {
  const location = useLocation();
  useEffect(() => {
    document.title = getRouteDocumentTitle(location.pathname, location.search);
  }, [location.pathname, location.search]);

  return null;
}

export default function App() {
  const { isPending: isSessionPending } = authClient.useSession();
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
      <DocumentTitleManager />
      <RouteTransitionLoading />
      <AppRoutes hasUsers={hasUsers} />
      <Toaster />
    </BrowserRouter>
  );
}
