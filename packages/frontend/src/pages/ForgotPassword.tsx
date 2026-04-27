import { authClient } from "@/lib/auth-client";
import {
  Button,
  Callout,
  CalloutDescription,
  Input,
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
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ROUTES } from "@/app/router/paths";
import { AuthShell } from "@/components/auth/AuthShell";
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

  const isSubmitting = form.formState.isSubmitting;

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
    <AuthShell
      title="Reset access"
      description="Enter your account email and we'll send the reset link if the account exists."
      footer={
        <Link
          to={ROUTES.LOGIN}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-[0.8rem] font-medium">
                  Email
                </FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    className="h-10"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {statusMessage && (
            <Callout
              tone={statusMessage.kind === "error" ? "danger" : "info"}
              className="py-3"
            >
              <CalloutDescription>{statusMessage.text}</CalloutDescription>
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
                Sending link
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
