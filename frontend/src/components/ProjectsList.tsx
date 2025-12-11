import { trpc } from "@/lib/trpc"
import { useState } from "react"
import { ProjectCard } from "./ProjectCard"
import { OverwriteDialog } from "./OverwriteDialog"

interface ProjectsListProps {
    onPreview: (url: string, originalUrl?: string, slug?: string) => void
}

export function ProjectsList({ onPreview }: ProjectsListProps) {
    const { data: projectsData, isLoading, error } = trpc.project.list.useQuery(undefined, {
        refetchInterval: 2000 // Poll every 2 seconds to check status
    })
    const { mutateAsync: regenerateProject } = trpc.project.regenerate.useMutation()
    const [regeneratingSlug, setRegeneratingSlug] = useState<string | null>(null)
    const [confirmationSlug, setConfirmationSlug] = useState<string | null>(null)

    const handleRegenerateClick = (slug: string) => {
        setConfirmationSlug(slug);
    }

    const handleConfirmRegenerate = async () => {
        if (!confirmationSlug) return;
        const slug = confirmationSlug;
        setConfirmationSlug(null);

        setRegeneratingSlug(slug)
        try {
            await regenerateProject({ slug })
        } catch (error) {
            console.error(error)
            alert(`Failed to regenerate ${slug}: ${(error as Error).message}`)
        } finally {
            setRegeneratingSlug(null)
        }
    }

    if (isLoading) {
        return (
            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="h-48 rounded-xl border bg-card text-card-foreground shadow animate-pulse" />
                ))}
            </div>
        )
    }

    if (error) return <div className="mt-8 text-red-500">Error loading projects</div>

    return (
        <div className="mt-8">
            <h2 className="text-2xl font-bold tracking-tight mb-4">Your Projects</h2>
            {projectsData?.projects.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-xl">
                    <p className="text-muted-foreground">No projects generated yet. create one above!</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projectsData?.projects.map(project => (
                        <ProjectCard
                            key={project.slug}
                            project={project}
                            onPreview={(url, originalUrl) => onPreview(url, originalUrl, project.slug)}
                            onRegenerate={handleRegenerateClick}
                            isRegenerating={regeneratingSlug === project.slug}
                        />
                    ))}
                </div>
            )}

            <OverwriteDialog
                open={!!confirmationSlug}
                onOpenChange={(open) => !open && setConfirmationSlug(null)}
                onConfirm={handleConfirmRegenerate}
                projectName={confirmationSlug || undefined}
            />
        </div>
    )
}
