import { useState } from "react"
import { trpc } from "@/lib/trpc"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ProjectsList } from "@/components/ProjectsList"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form"

const generateSchema = z.object({
    url: z.string().min(1, "URL is required"),
})

type GenerateFormValues = z.infer<typeof generateSchema>

export default function Dashboard() {
    const [slug, setSlug] = useState<string | null>(null)
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
        }
    })

    // Poll status if slug exists
    const statusQuery = trpc.project.status.useQuery(
        { slug: slug! },
        {
            enabled: !!slug,
            refetchInterval: (query) => {
                // Stop polling if completed
                return query.state.data?.status === 'completed' ? false : 5000
            }
        }
    )

    const onSubmit = async (data: GenerateFormValues) => {
        try {
            let urlToSubmit = data.url.trim();
            // Prepend https:// if missing protocol
            if (!/^https?:\/\//i.test(urlToSubmit)) {
                urlToSubmit = `https://${urlToSubmit}`;
            }

            const result = await generateMutation.mutateAsync({ url: urlToSubmit })
            if (result?.slug) {
                setSlug(result.slug)
            }
        } catch (e) {
            // Handled by onError
        }
    }

    return (
        <div className="p-8">
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


                    {slug && (
                        <div className="mt-4">
                            <h3 className="font-semibold">Status: <span className="font-normal">{statusQuery.data?.status || "Loading..."}</span></h3>
                            {statusQuery.data?.status === 'completed' && 'url' in statusQuery.data && (
                                <div className="mt-2">
                                    <a href={`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${statusQuery.data.url}`} target="_blank" rel="noreferrer" className="text-blue-500 underline block mb-2">
                                        Open in new tab
                                    </a>
                                    <div className="border rounded overflow-hidden">
                                        <iframe src={`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${statusQuery.data.url}`} className="w-full h-[600px]" title="Preview" />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            <ProjectsList />
        </div>
    )
}
