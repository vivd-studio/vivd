import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Copy, Check, ExternalLink } from "lucide-react"
import { useState } from "react"

interface PreviewModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    url: string | null
}

export function PreviewModal({ open, onOpenChange, url }: PreviewModalProps) {
    const [copied, setCopied] = useState(false)

    if (!url) return null

    // Ensure we have a full URL
    const fullUrl = url.startsWith('http') || url.startsWith('/api')
        ? url
        : `/api${url}`

    const handleCopy = () => {
        const absoluteUrl = fullUrl.startsWith('http')
            ? fullUrl
            : `${window.location.origin}${fullUrl}`

        navigator.clipboard.writeText(absoluteUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] w-full h-[90vh] flex flex-col p-0 gap-0">
                <DialogHeader className="px-6 py-4 border-b flex flex-row items-center gap-4 space-y-0">
                    <DialogTitle>Preview</DialogTitle>
                    <Button variant="outline" size="sm" onClick={handleCopy}>
                        {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                        {copied ? "Copied" : "Copy Link"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => window.open(fullUrl, '_blank')}>
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Open Page
                    </Button>
                    <DialogDescription className="sr-only">
                        Preview of the generated landing page
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-1 w-full bg-muted/20">
                    <iframe
                        src={fullUrl}
                        className="w-full h-full border-0"
                        title="Preview"
                        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                    />
                </div>
            </DialogContent>
        </Dialog>
    )
}
