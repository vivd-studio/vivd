import { trpc } from "@/lib/trpc"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface ProjectsListProps {
    onPreview: (url: string) => void
}

export function ProjectsList({ onPreview }: ProjectsListProps) {
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
                            // Normalize the URL
                            const previewUrl = `/api/preview/${project}/index.html`

                            return (
                                <div
                                    key={project}
                                    className="flex items-center justify-between p-2 border rounded hover:bg-slate-50 cursor-pointer"
                                    onClick={() => onPreview(previewUrl)}
                                >
                                    <span className="font-medium">{project}</span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            window.open(previewUrl, '_blank')
                                        }}
                                    >
                                        Open Page
                                    </Button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
