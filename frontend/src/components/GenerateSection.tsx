import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { trpc } from "@/lib/trpc"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const generateSchema = z.object({
    url: z.string().min(1, "URL is required"),
})

type GenerateFormValues = z.infer<typeof generateSchema>

interface GenerateSectionProps {
    onGenerationStarted: (slug: string) => void
}

export function GenerateSection({ onGenerationStarted }: GenerateSectionProps) {
    const form = useForm<GenerateFormValues>({
        resolver: zodResolver(generateSchema),
        defaultValues: {
            url: "",
        },
    })

    const generateMutation = trpc.project.generate.useMutation({
        onError: (error) => {
            console.error("Mutation error:", error);
            form.setError("root", { message: error.message || "Failed to start generation" });
        },
        onSuccess: (data) => {
            if (data.slug) {
                onGenerationStarted(data.slug)
            }
        }
    })

    const onSubmit = async (data: GenerateFormValues) => {
        try {
            let urlToSubmit = data.url.trim();
            // Prepend https:// if missing protocol
            if (!/^https?:\/\//i.test(urlToSubmit)) {
                urlToSubmit = `https://${urlToSubmit}`;
            }

            await generateMutation.mutateAsync({ url: urlToSubmit })
        } catch (e) {
            // Handled by onError
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Generate Landing Page</CardTitle>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <div className="flex gap-2 items-start">
                            <FormField
                                control={form.control}
                                name="url"
                                render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormControl>
                                            <Input placeholder="https://example.com" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <Button type="submit" disabled={generateMutation.isPending}>
                                {generateMutation.isPending ? "Starting..." : "Generate"}
                            </Button>
                        </div>
                        {form.formState.errors.root && (
                            <p className="text-sm font-medium text-destructive">
                                {form.formState.errors.root.message}
                            </p>
                        )}
                    </form>
                </Form>
            </CardContent>
        </Card>
    )
}
