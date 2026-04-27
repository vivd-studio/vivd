import { authClient } from "@/lib/auth-client";
import {
  Button,
  Callout,
  CalloutDescription,
  PasswordInput,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@vivd/ui";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ROUTES } from "@/app/router/paths";
import { AuthShell } from "@/components/auth/AuthShell";

const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z
      .string()
      .min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

function getResetErrorMessage(errorCode: string | null): string | null {
  if (!errorCode) return null;
  if (errorCode === "INVALID_TOKEN") {
    return "This password reset link is invalid or expired.";
  }
  return "The password reset link is not valid.";
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const resetError = getResetErrorMessage(searchParams.get("error"));

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  const handleSubmit = async (data: ResetPasswordFormValues) => {
    if (!token) {
      form.setError("root", {
        message: "Missing reset token. Request a new password reset email.",
      });
      return;
    }

    const result = await authClient.resetPassword({
      token,
      newPassword: data.newPassword,
    });

    if (result.error) {
      form.setError("root", { message: result.error.message });
      return;
    }

    navigate(`${ROUTES.LOGIN}?reset=success`, { replace: true });
  };

  return (
    <AuthShell
      title="Set new password"
      description="Choose a password you can use to get back into your Vivd workspace."
      footer={
        <Link
          to={ROUTES.LOGIN}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      {resetError ? (
        <div className="space-y-5">
          <Callout tone="danger" className="py-3">
            <CalloutDescription>{resetError}</CalloutDescription>
          </Callout>
          <Button asChild size="lg" className="h-10 w-full">
            <Link to={ROUTES.FORGOT_PASSWORD}>Request a new reset email</Link>
          </Button>
        </div>
      ) : (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-5"
          >
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-[0.8rem] font-medium">
                    New password
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      className="h-10"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-[0.8rem] font-medium">
                    Confirm password
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      className="h-10"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.formState.errors.root && (
              <Callout tone="danger" className="py-3">
                <CalloutDescription>
                  {form.formState.errors.root.message}
                </CalloutDescription>
              </Callout>
            )}

            <Button
              type="submit"
              size="lg"
              className="mt-2 h-10 w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Updating password
                </>
              ) : (
                "Update password"
              )}
            </Button>
          </form>
        </Form>
      )}
    </AuthShell>
  );
}
