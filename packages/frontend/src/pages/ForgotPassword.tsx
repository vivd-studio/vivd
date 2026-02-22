import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Link } from "react-router-dom";
import { ROUTES } from "@/app/router/paths";
import { useState } from "react";

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPassword() {
  const [statusMessage, setStatusMessage] = useState<{
    kind: "error" | "info";
    text: string;
  } | null>(null);

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const handleSubmit = async (data: ForgotPasswordFormValues) => {
    setStatusMessage(null);
    const redirectTo = `${window.location.origin}${ROUTES.RESET_PASSWORD}`;
    const result = await authClient.requestPasswordReset({
      email: data.email,
      redirectTo,
    });

    if (result.error) {
      setStatusMessage({
        kind: "error",
        text: result.error.message || "Failed to send reset link.",
      });
      return;
    }

    form.reset({ email: data.email });
    setStatusMessage({
      kind: "info",
      text: "If the email exists, a reset link was sent. Please check your inbox.",
    });
  };

  return (
    <div className="flex h-screen items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Forgot password</CardTitle>
          <p className="text-sm text-gray-500">
            Enter your account email to receive a reset link.
          </p>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="grid gap-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="m@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {statusMessage && (
                <p
                  className={`text-sm font-medium ${
                    statusMessage.kind === "error"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {statusMessage.text}
                </p>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? "Sending link..." : "Send reset link"}
              </Button>

              <Link
                to={ROUTES.LOGIN}
                className="text-center text-sm text-muted-foreground hover:underline"
              >
                Back to login
              </Link>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
