import { authClient } from "@/lib/auth-client";
import {
  Button,
  Callout,
  CalloutDescription,
  Input,
  PasswordInput,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@vivd/ui";

import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2 } from "lucide-react";
import { ROUTES } from "@/app/router/paths";
import { AuthShell } from "@/components/auth/AuthShell";
import { getDocsUrl } from "@/lib/docsUrl";
import { hardRedirect } from "@/lib/hardRedirect";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function resolveNextPath(rawNext: string | null): string | null {
  if (!rawNext) return null;
  if (!rawNext.startsWith("/") || rawNext.startsWith("//")) return null;
  return rawNext;
}

export default function Login() {
  const [searchParams] = useSearchParams();
  const wasReset = searchParams.get("reset") === "success";
  const wasVerified = searchParams.get("verified") === "1";
  const nextPath = resolveNextPath(searchParams.get("next"));
  const docsUrl = getDocsUrl("/");
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  const handleLogin = async (data: LoginFormValues) => {
    await authClient.signIn.email(
      {
        email: data.email,
        password: data.password,
      },
      {
        onSuccess: () => {
          hardRedirect(nextPath || ROUTES.DASHBOARD);
        },
        onError: (ctx) => {
          form.setError("root", { message: ctx.error.message });
        },
      },
    );
  };

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to your workspace and pick up where the site work left off."
      footer={
        <>
          New to Vivd?{" "}
          <a
            href={docsUrl}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Read the product docs
          </a>
        </>
      }
    >
      {(wasReset || wasVerified) && (
        <Callout tone="success" className="mb-6 py-3">
          <CalloutDescription>
            {wasReset
              ? "Password updated. You can now sign in."
              : "Email verified successfully."}
          </CalloutDescription>
        </Callout>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleLogin)} className="space-y-5">
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

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <FormLabel className="text-[0.8rem] font-medium">
                    Password
                  </FormLabel>
                  <Link
                    to={ROUTES.FORGOT_PASSWORD}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <FormControl>
                  <PasswordInput
                    autoComplete="current-password"
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
                Signing in
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
