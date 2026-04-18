import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Button } from "@vivd/ui";


interface OverwriteDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
    projectName?: string // Make optional to handle generic cases or specific project names
}

export function OverwriteDialog({ open, onOpenChange, onConfirm, projectName }: OverwriteDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Project Already Exists</DialogTitle>
                    <DialogDescription>
                        {projectName
                            ? `A project for "${projectName}" already exists.`
                            : "A project for this URL already exists."}
                        {" "}Do you want to overwrite it?
                        This will delete all existing generated files for this project.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button variant="destructive" onClick={onConfirm}>
                        Overwrite
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
