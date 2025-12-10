import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, Loader2 } from "lucide-react"

export interface Project {
    slug: string
    url: string
    status: string
    createdAt: string
}

interface ProjectCardProps {
    project: Project
    onPreview: (url: string, originalUrl?: string, projectSlug?: string) => void
    onRegenerate: (slug: string) => void
    isRegenerating: boolean
}

export function ProjectCard({ project, onPreview, onRegenerate, isRegenerating }: ProjectCardProps) {
    const isCompleted = project.status === 'completed'
    const isFailed = project.status === 'failed'
    const isProcessing = !isCompleted && !isFailed && project.status !== 'unknown'

    // Calculate progress and label
    let statusLabel = 'Pending'
    let statusColor: "default" | "secondary" | "destructive" | "outline" = "secondary"

    switch (project.status) {
        case 'pending':
            statusLabel = 'Pending'
            break
        case 'scraping':
            statusLabel = 'Scraping Website'
            statusColor = "default"
            break
        case 'analyzing_images':
            statusLabel = 'Analyzing Images'
            statusColor = "default"
            break
        case 'creating_hero':
            statusLabel = 'Creating Hero Image'
            statusColor = "default"
            break
        case 'generating_html':
            statusLabel = 'Generating HTML'
            statusColor = "default"
            break
        case 'completed':
            statusLabel = 'Completed'
            statusColor = "outline" // Will be overridden by className for specific green style
            break
        case 'failed':
            statusLabel = 'Failed'
            statusColor = "destructive"
            break
        default:
            statusLabel = project.status
    }

    const previewUrl = `/api/preview/${project.slug}/index.html`

    return (
        <Card
            className={`flex flex-col h-full overflow-hidden transition-all hover:shadow-md min-h-[190px] ${isProcessing ? 'border-primary ring-1 ring-primary/20 animate-pulse duration-3000' : ''
                } ${isCompleted ? 'cursor-pointer hover:border-primary/50' : ''
                }`}
            onClick={() => {
                if (isCompleted) {
                    onPreview(previewUrl, project.url, project.slug)
                }
            }}
        >
            <CardHeader className="pb-3">
                <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-lg font-medium truncate" title={project.slug}>
                        {project.slug}
                    </CardTitle>
                    <Badge
                        variant={statusColor}
                        className={`shrink-0 ${isCompleted ? 'bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 border-green-500/20' : ''}`}
                    >
                        {statusLabel}
                    </Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate" title={project.url}>
                    {project.url}
                </div>
            </CardHeader>
            <CardContent className="pb-3 grow flex items-center justify-center">
                {isProcessing && (
                    <div className="flex items-center gap-3 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-sm font-medium">{statusLabel}...</span>
                    </div>
                )}

                {isFailed && (
                    <div className="text-sm text-center text-destructive">
                        Generation failed
                    </div>
                )}
            </CardContent>
            <CardFooter className="pt-0 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-muted-foreground hover:text-primary"
                        disabled={!isCompleted}
                        onClick={(e) => {
                            e.stopPropagation()
                            window.open(previewUrl, '_blank')
                        }}
                    >
                        Open in new tab
                    </Button>
                    <span className="text-muted-foreground/30">•</span>
                    <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-muted-foreground hover:text-primary"
                        disabled={!isCompleted}
                        onClick={(e) => {
                            e.stopPropagation()
                            window.open(project.url, '_blank')
                        }}
                    >
                        Original Website
                    </Button>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    className="px-2 ml-auto"
                    disabled={isProcessing || isRegenerating}
                    onClick={(e) => {
                        e.stopPropagation()
                        onRegenerate(project.slug)
                    }}
                    title="Regenerate"
                >
                    <RefreshCw className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
                </Button>
            </CardFooter>
        </Card>
    )
}
