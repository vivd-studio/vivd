import { useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Loader2 } from "lucide-react";
import { LoadingSpinner } from "@/components/common";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { ROUTES } from "@/app/router/paths";
import { hardRedirect } from "@/lib/hardRedirect";
import { buildHostOrigin } from "@/lib/localHostRouting";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, Input, PasswordInput } from "@vivd/ui";


const inviteSignupSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type InviteSignupFormValues = z.infer<typeof inviteSignupSchema>;

function formatRole(role: string): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "User";
    case "client_editor":
      return "Client Editor";
    default:
      return role;
  }
}

function buildInviteReturnPath(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

export default function InviteAccept() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [actionError, setActionError] = useState<string | null>(null);
  const token = searchParams.get("token")?.trim() ?? "";
  const { data: session } = authClient.useSession();

  const signupForm = useForm<InviteSignupFormValues>({
    resolver: zodResolver(inviteSignupSchema),
    defaultValues: {
      name: "",
      password: "",
      confirmPassword: "",
    },
  });

  const inviteQuery = trpc.organization.getInviteDetails.useQuery(
    { token },
    {
      enabled: token.length > 0,
      retry: false,
    },
  );
  const acceptInviteForSignedInUser =
    trpc.organization.acceptInviteForSignedInUser.useMutation();
  const acceptInviteWithSignup = trpc.organization.acceptInviteWithSignup.useMutation();

  const invite = inviteQuery.data;
  const sessionEmail = session?.user.email.trim().toLowerCase() ?? null;
  const inviteEmail = invite?.email.trim().toLowerCase() ?? null;
  const isMatchingSignedInUser =
    Boolean(sessionEmail) && Boolean(inviteEmail) && sessionEmail === inviteEmail;
  const inviteReturnPath = useMemo(
    () => buildInviteReturnPath(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const loginHref = `${ROUTES.LOGIN}?next=${encodeURIComponent(inviteReturnPath)}`;

  const redirectToApp = (tenantHost: string | null) => {
    if (tenantHost) {
      hardRedirect(`${buildHostOrigin(tenantHost, window.location.host)}${ROUTES.DASHBOARD}`);
      return;
    }
    hardRedirect(ROUTES.DASHBOARD);
  };

  const handleExistingAccountAccept = async () => {
    if (!token) return;
    setActionError(null);
    try {
      const result = await acceptInviteForSignedInUser.mutateAsync({ token });
      redirectToApp(result.tenantHost);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to accept invite");
    }
  };

  const handleSignupAccept = async (values: InviteSignupFormValues) => {
    if (!token) return;
    setActionError(null);
    try {
      const result = await acceptInviteWithSignup.mutateAsync({
        token,
        name: values.name,
        password: values.password,
      });
      await authClient.signIn.email(
        {
          email: result.email,
          password: values.password,
        },
        {
          onSuccess: () => {
            redirectToApp(result.tenantHost);
          },
          onError: (ctx) => {
            setActionError(ctx.error.message);
          },
        },
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to accept invite");
    }
  };

  const handleSignOut = async () => {
    setActionError(null);
    await authClient.signOut();
  };

  if (!token) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Invitation link missing</CardTitle>
            <CardDescription>
              Open the full invite email link to continue.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (inviteQuery.isLoading) {
    return <LoadingSpinner message="Loading invitation..." />;
  }

  if (inviteQuery.error || !invite) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Invitation unavailable</CardTitle>
            <CardDescription>
              {inviteQuery.error?.message ?? "This invitation is invalid or no longer available."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link to={ROUTES.LOGIN}>Go to login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isPending = invite.state === "pending" && invite.organizationStatus === "active";
  const showSignupForm = isPending && !invite.hasExistingAccount && !session;
  const showExistingAccountPrompt = isPending && invite.hasExistingAccount && !session;
  const showSignedInAccept = isPending && Boolean(session) && isMatchingSignedInUser;
  const showMismatch =
    isPending && Boolean(session) && !isMatchingSignedInUser;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Organization invite</CardTitle>
          <CardDescription>
            Join {invite.organizationName} as {formatRole(invite.role)}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2 rounded-lg border bg-muted/10 p-4 text-sm">
            <div>
              <span className="font-medium">Email:</span> {invite.email}
            </div>
            <div>
              <span className="font-medium">Role:</span> {formatRole(invite.role)}
            </div>
            {invite.projectTitle ? (
              <div>
                <span className="font-medium">Assigned project:</span> {invite.projectTitle}
              </div>
            ) : null}
            {invite.inviterName || invite.inviterEmail ? (
              <div>
                <span className="font-medium">Invited by:</span>{" "}
                {invite.inviterName || invite.inviterEmail}
              </div>
            ) : null}
          </div>

          {invite.organizationStatus !== "active" ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              This organization is currently suspended, so the invite cannot be accepted.
            </div>
          ) : null}

          {invite.state === "expired" ? (
            <div className="rounded-lg border p-4 text-sm text-muted-foreground">
              This invitation has expired. Ask an admin to resend it.
            </div>
          ) : null}

          {invite.state === "canceled" ? (
            <div className="rounded-lg border p-4 text-sm text-muted-foreground">
              This invitation was canceled. Ask an admin for a new invite if you still
              need access.
            </div>
          ) : null}

          {invite.state === "accepted" ? (
            <div className="space-y-3">
              <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                This invitation has already been accepted.
              </div>
              <Button asChild className="w-full">
                <Link to={ROUTES.LOGIN}>Go to login</Link>
              </Button>
            </div>
          ) : null}

          {showExistingAccountPrompt ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                An account already exists for this email. Sign in first, then accept the
                invite.
              </p>
              <Button asChild className="w-full">
                <Link to={loginHref}>Sign in to accept invite</Link>
              </Button>
            </div>
          ) : null}

          {showMismatch ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                You are signed in as {session?.user.email}, but this invite is for{" "}
                {invite.email}. Sign out and continue with the invited email address.
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleSignOut}
              >
                Sign out
              </Button>
            </div>
          ) : null}

          {showSignedInAccept ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You are signed in with the invited email address and can accept this
                invitation now.
              </p>
              <Button
                className="w-full"
                onClick={handleExistingAccountAccept}
                disabled={acceptInviteForSignedInUser.isPending}
              >
                {acceptInviteForSignedInUser.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Accept invitation
              </Button>
            </div>
          ) : null}

          {showSignupForm ? (
            <Form {...signupForm}>
              <form
                onSubmit={signupForm.handleSubmit(handleSignupAccept)}
                className="space-y-4"
              >
                <FormField
                  control={signupForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Your name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={signupForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <PasswordInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={signupForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <PasswordInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={acceptInviteWithSignup.isPending}
                >
                  {acceptInviteWithSignup.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Create account and accept invite
                </Button>
              </form>
            </Form>
          ) : null}

          {actionError ? (
            <p className="text-sm font-medium text-destructive">{actionError}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
