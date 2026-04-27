import { authClient } from "@/lib/auth-client";
import {
  Button,
  Callout,
  CalloutDescription,
  Input,
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
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
      <Panel className="w-full max-w-sm">
        <PanelHeader>
          <PanelTitle className="text-2xl">Forgot password</PanelTitle>
          <PanelDescription>
            Enter your account email to receive a reset link.
          </PanelDescription>
        </PanelHeader>
        <PanelContent>
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
                      <Input
                        type="email"
                        placeholder="m@example.com"
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
                className="w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting
                  ? "Sending link..."
                  : "Send reset link"}
              </Button>

              <Link
                to={ROUTES.LOGIN}
                className="text-center text-sm text-muted-foreground hover:underline"
              >
                Back to login
              </Link>
            </form>
          </Form>
        </PanelContent>
      </Panel>
    </div>
  );
}
