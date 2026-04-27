import { authClient } from "@/lib/auth-client";
import {
  Button,
  Callout,
  CalloutDescription,
  Input,
  PasswordInput,
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
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
import { ROUTES } from "@/app/router/paths";
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
    <div className="flex h-screen items-center justify-center">
      <Panel className="w-full max-w-sm">
        <PanelHeader>
          <PanelTitle className="text-2xl">Login</PanelTitle>
        </PanelHeader>
        <PanelContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleLogin)}
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
              <FormField
                control={form.control}
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
              <Link
                to={ROUTES.FORGOT_PASSWORD}
                className="text-sm text-muted-foreground hover:underline"
              >
                Forgot password?
              </Link>

              {wasReset && (
                <Callout tone="success" className="py-3">
                  <CalloutDescription>
                    Password updated. You can now sign in.
                  </CalloutDescription>
                </Callout>
              )}

              {wasVerified && (
                <Callout tone="success" className="py-3">
                  <CalloutDescription>
                    Email verified successfully.
                  </CalloutDescription>
                </Callout>
              )}

              {form.formState.errors.root && (
                <Callout tone="danger" className="py-3">
                  <CalloutDescription>
                    {form.formState.errors.root.message}
                  </CalloutDescription>
                </Callout>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? "Logging in..." : "Login"}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                New to Vivd?{" "}
                <a
                  href={docsUrl}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Read the product docs
                </a>
              </p>
            </form>
          </Form>
        </PanelContent>
      </Panel>
    </div>
  );
}
