import { authClient } from "@/lib/auth-client";
import { Button, Input, PasswordInput, Card, CardContent, CardHeader, CardTitle, CardDescription, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, Tabs, TabsContent, TabsList, TabsTrigger } from "@vivd/ui";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { SettingsPageShell, FormContent } from "@/components/settings/SettingsPageShell";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { ROUTES } from "@/app/router/paths";

const profileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z
      .string()
      .min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ProfileFormValues = z.infer<typeof profileSchema>;
type PasswordFormValues = z.infer<typeof passwordSchema>;

export default function Settings() {
  const { data: session } = authClient.useSession();
  const [isSendingVerificationEmail, setIsSendingVerificationEmail] =
    useState(false);
  const isEmailVerified = Boolean(session?.user?.emailVerified);

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: "",
      email: "",
    },
  });

  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (session?.user) {
      profileForm.reset({
        name: session.user.name,
        email: session.user.email,
      });
    }
  }, [session, profileForm]);

  const handleUpdateProfile = async (data: ProfileFormValues) => {
    if (!session?.user) {
      toast.error("Error", { description: "Session not available. Please try again." });
      return;
    }

    const currentName = session?.user.name ?? "";
    const currentEmail = session?.user.email ?? "";
    const changedName = data.name !== currentName;
    const changedEmail = data.email.toLowerCase() !== currentEmail.toLowerCase();

    if (!changedName && !changedEmail) {
      toast.message("No changes to save");
      return;
    }

    if (changedName) {
      const result = await authClient.updateUser({
        name: data.name,
      });
      if (result.error) {
        toast.error("Error", {
          description: result.error.message,
        });
        return;
      }
    }

    if (changedEmail) {
      const result = await authClient.changeEmail({
        newEmail: data.email,
      });
      if (result.error) {
        toast.error("Error", {
          description: result.error.message,
        });
        return;
      }
    }

    toast.success("Profile updated", {
      description: changedEmail
        ? "Your profile was updated. If required, confirm your new email address."
        : "Your profile has been updated successfully.",
    });
  };

  const handleUpdatePassword = async (data: PasswordFormValues) => {
    await authClient.changePassword(
      {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
        revokeOtherSessions: true,
      },
      {
        onSuccess: () => {
          toast.success("Password updated", {
            description: "Your password has been changed successfully.",
          });
          passwordForm.reset();
        },
        onError: (ctx) => {
          toast.error("Error", {
            description: ctx.error.message,
          });
        },
      },
    );
  };

  const handleSendVerificationEmail = async () => {
    if (!session?.user.email) {
      toast.error("Error", {
        description: "Session not available. Please try again.",
      });
      return;
    }

    setIsSendingVerificationEmail(true);
    try {
      const result = await authClient.sendVerificationEmail({
        email: session.user.email,
        callbackURL: `${window.location.origin}${ROUTES.LOGIN}?verified=1`,
      });

      if (result.error) {
        toast.error("Error", {
          description: result.error.message,
        });
        return;
      }

      toast.success("Verification email sent", {
        description: "Check your inbox for the verification link.",
      });
    } finally {
      setIsSendingVerificationEmail(false);
    }
  };

  return (
    <SettingsPageShell
      title="Settings"
      description="Manage your account profile and security settings."
    >
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <FormContent>
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>Update your personal information and email.</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...profileForm}>
                  <form
                    onSubmit={profileForm.handleSubmit(handleUpdateProfile)}
                    className="space-y-4"
                  >
                  <FormField
                    control={profileForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={profileForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex items-center text-sm">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        isEmailVerified
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                      }`}
                    >
                      {isEmailVerified ? "Verified" : "Unverified"}
                    </span>
                  </div>
                  {!isEmailVerified && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm">
                      <p className="font-medium text-amber-900">
                        Your email address is not verified yet.
                      </p>
                      <p className="mt-1 text-amber-800">
                        Verify your email to improve account security and account
                        recovery.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-3"
                        onClick={handleSendVerificationEmail}
                        disabled={isSendingVerificationEmail}
                      >
                        {isSendingVerificationEmail
                          ? "Sending..."
                          : "Send verification email"}
                      </Button>
                    </div>
                  )}
                  <Button
                    type="submit"
                    disabled={profileForm.formState.isSubmitting}
                  >
                    {profileForm.formState.isSubmitting
                      ? "Saving..."
                      : "Save Changes"}
                  </Button>
                </form>
              </Form>
              </CardContent>
            </Card>
          </FormContent>
        </TabsContent>

        <TabsContent value="password" className="mt-6">
          <FormContent>
            <Card>
              <CardHeader>
                <CardTitle>Password</CardTitle>
                <CardDescription>Change your password.</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...passwordForm}>
                  <form
                    onSubmit={passwordForm.handleSubmit(handleUpdatePassword)}
                    className="space-y-4"
                  >
                  <FormField
                    control={passwordForm.control}
                    name="currentPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current Password</FormLabel>
                        <FormControl>
                          <PasswordInput {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={passwordForm.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Password</FormLabel>
                        <FormControl>
                          <PasswordInput {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={passwordForm.control}
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
                    disabled={passwordForm.formState.isSubmitting}
                  >
                    {passwordForm.formState.isSubmitting
                      ? "Changing..."
                      : "Change Password"}
                  </Button>
                </form>
              </Form>
              </CardContent>
            </Card>
          </FormContent>
        </TabsContent>
      </Tabs>
    </SettingsPageShell>
  );
}
