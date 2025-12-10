import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { trpc } from "@/lib/trpc"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { OverwriteDialog } from "./OverwriteDialog"
import { useState } from "react"

const generateSchema = z.object({
    url: z.string().min(1, "URL is required"),
})

type GenerateFormValues = z.infer<typeof generateSchema>

interface GenerateSectionProps {
    onGenerationStarted: (slug: string) => void
}

export function GenerateSection({ onGenerationStarted }: GenerateSectionProps) {
    const [isOverwriteDialogOpen, setIsOverwriteDialogOpen] = useState(false);
    const [pendingUrl, setPendingUrl] = useState<string | null>(null);

    const form = useForm<GenerateFormValues>({
        resolver: zodResolver(generateSchema),
        defaultValues: {
            url: "",
        },
    })

    const { mutateAsync: generate, isPending: isGenerating } = trpc.project.generate.useMutation({
        onError: (error) => {
            console.error("Mutation error:", error);
            // Check if it's the specific "processing" error
            if (error.message.includes("Project is currently being generated")) {
                form.setError("root", { message: "Project is currently being generated. Please wait." });
            } else {
                form.setError("root", { message: error.message || "Failed to start generation" });
            }
        },
        onSuccess: (data) => {
            if (data.status === 'exists') {
                setIsOverwriteDialogOpen(true);
            } else if (data.slug) {
                onGenerationStarted(data.slug)
            }
        }
    })

    const { mutateAsync: regenerate, isPending: isRegenerating } = trpc.project.regenerate.useMutation({
        onError: (error) => {
            console.error("Regenerate mutation error:", error);
            form.setError("root", { message: error.message || "Failed to regenerate" });
        },
        onSuccess: (data) => {
            if (data.slug) {
                onGenerationStarted(data.slug)
            }
        }
    })

    const handleOverwrite = async () => {
        if (!pendingUrl) return;
        setIsOverwriteDialogOpen(false);
        try {
            // Determine slug from URL (simple logic matching backend/shared understanding)
            let targetUrl = pendingUrl;
            if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
            const slug = new URL(targetUrl).hostname.replace('www.', '').split('.')[0];

            await regenerate({ slug })
        } catch (e) {
            // Error handled by mutation callbacks
        }
    }

    const onSubmit = async (data: GenerateFormValues) => {
        try {
            let urlToSubmit = data.url.trim();
            // Prepend https:// if missing protocol
            if (!/^https?:\/\//i.test(urlToSubmit)) {
                urlToSubmit = `https://${urlToSubmit}`;
            }

            setPendingUrl(urlToSubmit);
            await generate({ url: urlToSubmit })
        } catch (e) {
            // Handled by onError
        }
    }

    return (
        <>
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
                                                <div className="relative">
                                                    <Input
                                                        placeholder="Enter a URL to generate a landing page (e.g., https://example.com)"
                                                        className="shadow-sm border border-indigo-200 focus-visible:border-indigo-500 focus-visible:ring-indigo-500 transition-all duration-200"
                                                        {...field}
                                                    />
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <Button type="submit" disabled={isGenerating || isRegenerating} className="shadow-md transition-all hover:scale-105 active:scale-95 bg-indigo-600 hover:bg-indigo-700 text-white">
                                    {isGenerating || isRegenerating ? "Starting..." : "Generate"}
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

            <OverwriteDialog
                open={isOverwriteDialogOpen}
                onOpenChange={setIsOverwriteDialogOpen}
                onConfirm={handleOverwrite}
            />
        </>
    )
}
