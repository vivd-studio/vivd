import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Link, useSearchParams } from "react-router-dom"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { ROUTES } from "@/app/router/paths"
import { getDocsUrl } from "@/lib/docsUrl"
import { hardRedirect } from "@/lib/hardRedirect"

const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function Login() {
    const [searchParams] = useSearchParams()
    const wasReset = searchParams.get("reset") === "success"
    const wasVerified = searchParams.get("verified") === "1"
    const docsUrl = getDocsUrl("/")
    const form = useForm<LoginFormValues>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            email: "",
            password: "",
        },
    })

    const handleLogin = async (data: LoginFormValues) => {
        await authClient.signIn.email({
            email: data.email,
            password: data.password,
        }, {
            onSuccess: () => {
                hardRedirect(ROUTES.DASHBOARD)
            },
            onError: (ctx) => {
                form.setError("root", { message: ctx.error.message })
            }
        })
    }

    return (
        <div className="flex h-screen items-center justify-center">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <CardTitle className="text-2xl">Login</CardTitle>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleLogin)} className="grid gap-4">
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
                                <p className="text-sm font-medium text-emerald-600">
                                    Password updated. You can now sign in.
                                </p>
                            )}

                            {wasVerified && (
                                <p className="text-sm font-medium text-emerald-600">
                                    Email verified successfully.
                                </p>
                            )}

                            {form.formState.errors.root && (
                                <p className="text-sm font-medium text-destructive">
                                    {form.formState.errors.root.message}
                                </p>
                            )}

                            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                                {form.formState.isSubmitting ? "Logging in..." : "Login"}
                            </Button>

                            <p className="text-center text-xs text-muted-foreground">
                                New to Vivd?{" "}
                                <a href={docsUrl} className="underline underline-offset-4 hover:text-foreground">
                                    Read the product docs
                                </a>
                            </p>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    )
}
