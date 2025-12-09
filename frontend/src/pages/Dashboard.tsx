import { useState, useEffect } from "react"
import { trpc } from "@/lib/trpc"
import { ProjectsList } from "@/components/ProjectsList"
import { GenerateSection } from "@/components/GenerateSection"
import { PreviewModal } from "@/components/PreviewModal"
import { Button } from "@/components/ui/button"

export default function Dashboard() {
    const [slug, setSlug] = useState<string | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)

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

    // Watch for completion to auto-open preview for the current generation
    useEffect(() => {
        if (statusQuery.data?.status === 'completed' && 'url' in statusQuery.data && statusQuery.data.url) {
            const fullUrl = `/api${statusQuery.data.url}`
            setPreviewUrl(fullUrl)
            setIsPreviewOpen(true)
        }
    }, [statusQuery.data])

    const handlePreview = (url: string) => {
        setPreviewUrl(url)
        setIsPreviewOpen(true)
    }

    return (
        <div className="p-8 space-y-8">
            <GenerateSection onGenerationStarted={setSlug} />

            {slug && (
                <div className="mt-4 p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
                    <h3 className="font-semibold flex items-center gap-2">
                        Status: <span className="font-normal">{statusQuery.data?.status || "Loading..."}</span>
                        {statusQuery.data?.status === 'completed' && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    if ('url' in statusQuery.data! && statusQuery.data.url) {
                                        handlePreview(`/api${statusQuery.data.url}`)
                                    }
                                }}
                            >
                                Open Preview
                            </Button>
                        )}
                    </h3>
                </div>
            )}

            <ProjectsList onPreview={handlePreview} />

            <PreviewModal
                open={isPreviewOpen}
                onOpenChange={setIsPreviewOpen}
                url={previewUrl}
            />
        </div>
    )
}
