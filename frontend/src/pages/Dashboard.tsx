import { useState } from "react"
import { trpc } from "@/lib/trpc"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ProjectsList } from "@/components/ProjectsList"

export default function Dashboard() {
    const [url, setUrl] = useState("")
    const [slug, setSlug] = useState<string | null>(null)

    const generateMutation = trpc.project.generate.useMutation()

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

    const handleSubmit = async () => {
        try {
            const result = await generateMutation.mutateAsync({ url })
            if (result?.slug) {
                setSlug(result.slug)
            }
        } catch (e) {
            console.error(e)
            alert("Error starting generation")
        }
    }

    return (
        <div className="p-8">
            <Card>
                <CardHeader>
                    <CardTitle>Generate Landing Page</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2">
                        <Input placeholder="https://example.com" value={url} onChange={e => setUrl(e.target.value)} />
                        <Button onClick={handleSubmit} disabled={generateMutation.isPending}>
                            {generateMutation.isPending ? "Starting..." : "Generate"}
                        </Button>
                    </div>

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
