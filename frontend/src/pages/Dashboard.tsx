import { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { trpc } from "@/lib/trpc"
import { ProjectsList } from "@/components/ProjectsList"
import { GenerateSection } from "@/components/GenerateSection"
import { PreviewModal } from "@/components/PreviewModal"

export default function Dashboard() {
    const [searchParams, setSearchParams] = useSearchParams()
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [originalUrl, setOriginalUrl] = useState<string | null>(null)
    const [projectSlug, setProjectSlug] = useState<string | undefined>(undefined)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)

    // Fetch projects to find the one from URL if needed
    const { data: projectsData } = trpc.project.list.useQuery(undefined, {
        enabled: !!searchParams.get("project")
    })

    // Check URL for project slug on load/update
    useEffect(() => {
        const slugFromUrl = searchParams.get("project")
        if (slugFromUrl && projectsData) {
            const project = projectsData.projects.find(p => p.slug === slugFromUrl)
            if (project) {
                setPreviewUrl(`/api/preview/${project.slug}/index.html`)
                setOriginalUrl(project.url)
                setProjectSlug(project.slug)
                setIsPreviewOpen(true)
            }
        }
    }, [searchParams, projectsData])

    const handlePreview = (url: string, origUrl?: string, slug?: string) => {
        setPreviewUrl(url)
        setOriginalUrl(origUrl || null)
        setProjectSlug(slug)
        setIsPreviewOpen(true)

        if (slug) {
            setSearchParams(prev => {
                const newParams = new URLSearchParams(prev)
                newParams.set("project", slug)
                return newParams
            })
        }
    }

    const handleOpenChange = (open: boolean) => {
        setIsPreviewOpen(open)
        if (!open) {
            setSearchParams(prev => {
                const newParams = new URLSearchParams(prev)
                newParams.delete("project")
                return newParams
            })
        }
    }

    return (
        <div className="p-8 space-y-8">
            <GenerateSection onGenerationStarted={() => { }} />

            <ProjectsList onPreview={handlePreview} />

            <PreviewModal
                open={isPreviewOpen}
                onOpenChange={handleOpenChange}
                url={previewUrl}
                originalUrl={originalUrl}
                projectSlug={projectSlug}
            />
        </div>
    )
}
