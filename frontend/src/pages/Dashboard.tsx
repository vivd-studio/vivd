import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { postApiGenerate, getApiStatusBySlug } from "@/client/sdk.gen"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function Dashboard() {
    const [url, setUrl] = useState("")
    const [slug, setSlug] = useState<string | null>(null)

    const generateMutation = useMutation({
        mutationFn: async (url: string) => {
            const { data, error } = await postApiGenerate({ body: { url } })
            if (error) throw error
            return data
        }
    })

    // Poll status if slug exists
    const statusQuery = useQuery({
        queryKey: ['status', slug],
        queryFn: async () => {
            if (!slug) return null
            const { data } = await getApiStatusBySlug({ path: { slug } })
            return data
        },
        enabled: !!slug,
        refetchInterval: (query) => {
            // Stop polling if completed
            return query.state.data?.status === 'completed' ? false : 5000
        }
    })

    const handleSubmit = async () => {
        try {
            const result = await generateMutation.mutateAsync(url)
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
                            {statusQuery.data?.status === 'completed' && statusQuery.data.url && (
                                <div className="mt-2">
                                    <a href={`http://localhost:3000${statusQuery.data.url}`} target="_blank" rel="noreferrer" className="text-blue-500 underline block mb-2">
                                        Open in new tab
                                    </a>
                                    <div className="border rounded overflow-hidden">
                                        <iframe src={`http://localhost:3000${statusQuery.data.url}`} className="w-full h-[600px]" title="Preview" />
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

function ProjectsList() {
    const { data: projectsData, isLoading, error } = useQuery({
        queryKey: ['projects'],
        queryFn: async () => {
            const res = await fetch('http://localhost:3000/api/projects')
            if (!res.ok) throw new Error('Failed to fetch projects')
            return res.json() as Promise<{ projects: string[] }>
        }
    })

    if (isLoading) return <div className="mt-8">Loading projects...</div>
    if (error) return <div className="mt-8 text-red-500">Error loading projects</div>

    return (
        <Card className="mt-8">
            <CardHeader>
                <CardTitle>Generated Projects</CardTitle>
            </CardHeader>
            <CardContent>
                {projectsData?.projects.length === 0 ? (
                    <p className="text-muted-foreground">No projects generated yet.</p>
                ) : (
                    <div className="grid gap-2">
                        {projectsData?.projects.map(project => (
                            <div key={project} className="flex items-center justify-between p-2 border rounded hover:bg-slate-50">
                                <span className="font-medium">{project}</span>
                                <a
                                    href={`http://localhost:3000/preview/${project}/index.html`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-500 hover:underline"
                                >
                                    View
                                </a>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
