import { trpc } from "@/lib/trpc"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { RefreshCw } from "lucide-react"

interface ProjectsListProps {
    onPreview: (url: string) => void
}

export function ProjectsList({ onPreview }: ProjectsListProps) {
    const { data: projectsData, isLoading, error } = trpc.project.list.useQuery(undefined, {
        refetchInterval: 2000 // Poll every 2 seconds to check status
    })
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
                            const previewUrl = `/api/preview/${project.slug}/index.html`
                            const isProcessing = project.status !== 'completed' && project.status !== 'failed' && project.status !== 'unknown'
                            const isFailed = project.status === 'failed'
                            const isUnknown = project.status === 'unknown'

                            return (
                                <div
                                    key={project.slug}
                                    className={`flex items-center justify-between p-2 border rounded ${isProcessing ? 'opacity-70 cursor-not-allowed bg-slate-50' : 'hover:bg-slate-50 cursor-pointer'
                                        }`}
                                    onClick={() => {
                                        if (!isProcessing && !isFailed) {
                                            onPreview(previewUrl)
                                        }
                                    }}
                                >
                                    <div className="flex flex-col">
                                        <span className="font-medium">{project.slug}</span>
                                        <span className={`text-xs ${isFailed ? 'text-red-500' :
                                                isProcessing ? 'text-amber-500' :
                                                    isUnknown ? 'text-slate-500' :
                                                        'text-green-500'
                                            } uppercase`}>
                                            {project.status === 'pending' ? 'Starting...' : project.status.replace('_', ' ')}
                                        </span>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={isProcessing || regenerating === project.slug}
                                            onClick={(e) => handleRegenerate(e, project.slug)}
                                        >
                                            {regenerating === project.slug ? (
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <RefreshCw className="h-4 w-4" />
                                            )}
                                            <span className="ml-2">Regenerate</span>
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={isProcessing || isFailed}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                if (!isProcessing && !isFailed) {
                                                    window.open(previewUrl, '_blank')
                                                }
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
