import { authClient } from "@/lib/auth-client";
import {
  Button,
  Callout,
  CalloutDescription,
  Input,
  PasswordInput,
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
import { trpc } from "@/lib/trpc";
import { ROUTES } from "@/app/router/paths";
import { getDocsUrl } from "@/lib/docsUrl";
import { hardRedirect } from "@/lib/hardRedirect";

const signupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type SignupFormValues = z.infer<typeof signupSchema>;

export default function Signup() {
  const utils = trpc.useUtils();
  const docsUrl = getDocsUrl("/");
  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "Admin",
      email: "",
      password: "",
    },
  });

  const handleSignup = async (data: SignupFormValues) => {
    await authClient.signUp.email(
      {
        email: data.email,
        password: data.password,
        name: data.name,
        callbackURL: `${window.location.origin}${ROUTES.LOGIN}?verified=1`,
      },
      {
        onSuccess: async () => {
          await utils.user.hasUsers.invalidate();
          hardRedirect(ROUTES.DASHBOARD);
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
          <PanelTitle className="text-2xl">First Time Setup</PanelTitle>
          <PanelDescription>Create your admin account</PanelDescription>
        </PanelHeader>
        <PanelContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSignup)}
              className="grid gap-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Admin" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="admin@example.com"
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
                {form.formState.isSubmitting
                  ? "Creating Account..."
                  : "Create Admin Account"}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Need product guidance first?{" "}
                <a
                  href={docsUrl}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Read the docs
                </a>
              </p>
            </form>
          </Form>
        </PanelContent>
      </Panel>
    </div>
  );
}
