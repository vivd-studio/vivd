import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CenteredLoading } from "@/components/common";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { Navigate, useNavigate } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { ROUTES } from "@/app/router";

export default function NoProjectAssigned() {
  const navigate = useNavigate();
  const { isClientEditor } = usePermissions();
  const { data: session, isPending } = authClient.useSession();

  const { data: assignedProject, isLoading } =
    trpc.user.getMyAssignedProject.useQuery(undefined, {
      enabled: isClientEditor,
      refetchInterval: 5000,
    });

  if (isPending) {
    return <CenteredLoading fullScreen />;
  }

  if (!session) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  if (!isClientEditor) {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }

  if (isLoading) {
    return <CenteredLoading fullScreen />;
  }

  if (assignedProject?.projectSlug) {
    return (
      <Navigate to={ROUTES.PROJECT(assignedProject.projectSlug)} replace />
    );
  }

  const handleLogout = async () => {
    await authClient.signOut();
    navigate(ROUTES.LOGIN);
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>No Project Assigned</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Your account is not assigned to a project yet. Please contact an
            admin to assign you to a project.
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={handleLogout} variant="secondary">
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
