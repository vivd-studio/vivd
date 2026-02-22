import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ROUTES } from "@/app/router/paths";

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
    <div className="flex h-screen items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Set new password</CardTitle>
          <p className="text-sm text-gray-500">
            Choose a new password for your account.
          </p>
        </CardHeader>
        <CardContent>
          {resetError ? (
            <div className="grid gap-4">
              <p className="text-sm font-medium text-destructive">{resetError}</p>
              <Link
                to={ROUTES.FORGOT_PASSWORD}
                className="text-sm text-muted-foreground hover:underline"
              >
                Request a new reset email
              </Link>
            </div>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(handleSubmit)}
                className="grid gap-4"
              >
                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New password</FormLabel>
                      <FormControl>
                        <PasswordInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm password</FormLabel>
                      <FormControl>
                        <PasswordInput {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.formState.errors.root && (
                  <p className="text-sm font-medium text-destructive">
                    {form.formState.errors.root.message}
                  </p>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting
                    ? "Updating password..."
                    : "Update password"}
                </Button>

                <Link
                  to={ROUTES.LOGIN}
                  className="text-center text-sm text-muted-foreground hover:underline"
                >
                  Back to login
                </Link>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
