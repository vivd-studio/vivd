import { trpc } from "@/lib/trpc"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { RefreshCw } from "lucide-react"

interface ProjectsListProps {
    onPreview: (url: string) => void
}

export function ProjectsList({ onPreview }: ProjectsListProps) {
    const { data: projectsData, isLoading, error } = trpc.project.list.useQuery()
    const { mutateAsync: regenerateProject } = trpc.project.regenerate.useMutation()
    const [regenerating, setRegenerating] = useState<string | null>(null)

    const handleRegenerate = async (e: React.MouseEvent, slug: string) => {
        e.stopPropagation()
        if (!confirm(`Are you sure you want to regenerate ${slug}? This will delete the existing project.`)) return

        setRegenerating(slug)
        try {
            await regenerateProject({ slug })
            alert(`Regeneration started for ${slug}`)
        } catch (error) {
            console.error(error)
            alert(`Failed to regenerate ${slug}: ${(error as Error).message}`)
        } finally {
            setRegenerating(null)
        }
    }

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
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={regenerating === project}
                                            onClick={(e) => handleRegenerate(e, project)}
                                        >
                                            {regenerating === project ? (
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <RefreshCw className="h-4 w-4" />
                                            )}
                                            <span className="ml-2">Regenerate</span>
                                        </Button>
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
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
