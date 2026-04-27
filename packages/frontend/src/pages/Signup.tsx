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

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ROUTES } from "@/app/router/paths";
import { AuthShell } from "@/components/auth/AuthShell";
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

  const isSubmitting = form.formState.isSubmitting;

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
    <AuthShell
      title="Set up your workspace"
      description="Create the first admin account and open the Vivd control plane."
      footer={
        <>
          Need product guidance first?{" "}
          <a
            href={docsUrl}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Read the docs
          </a>
        </>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSignup)} className="space-y-5">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className="text-[0.8rem] font-medium">
                  Name
                </FormLabel>
                <FormControl>
                  <Input
                    autoComplete="name"
                    placeholder="Admin"
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
                    placeholder="admin@company.com"
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
                <FormLabel className="text-[0.8rem] font-medium">
                  Password
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
                Creating account
              </>
            ) : (
              "Create admin account"
            )}
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
