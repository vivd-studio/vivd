import { trpc } from "@/lib/trpc"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ProjectsList() {
    const { data: projectsData, isLoading, error } = trpc.project.list.useQuery()

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
                        {projectsData?.projects.map(project => {
                            const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
                            return (
                                <div key={project} className="flex items-center justify-between p-2 border rounded hover:bg-slate-50">
                                    <span className="font-medium">{project}</span>
                                    <a
                                        href={`${baseUrl}/preview/${project}/index.html`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-blue-500 hover:underline"
                                    >
                                        View
                                    </a>
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
