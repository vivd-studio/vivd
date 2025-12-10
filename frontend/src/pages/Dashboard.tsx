import { useState } from "react"
import { ProjectsList } from "@/components/ProjectsList"
import { GenerateSection } from "@/components/GenerateSection"
import { PreviewModal } from "@/components/PreviewModal"

export default function Dashboard() {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [originalUrl, setOriginalUrl] = useState<string | null>(null)
    const [projectSlug, setProjectSlug] = useState<string | undefined>(undefined)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)

    const handlePreview = (url: string, origUrl?: string, slug?: string) => {
        setPreviewUrl(url)
        setOriginalUrl(origUrl || null)
        setProjectSlug(slug)
        setIsPreviewOpen(true)
    }

    return (
        <div className="p-8 space-y-8">
            <GenerateSection onGenerationStarted={() => { }} />

            <ProjectsList onPreview={handlePreview} />

            <PreviewModal
                open={isPreviewOpen}
                onOpenChange={setIsPreviewOpen}
                url={previewUrl}
                originalUrl={originalUrl}
                projectSlug={projectSlug}
            />
        </div>
    )
}
