import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { trpc } from "@/lib/trpc"
import { Loader2, Send } from "lucide-react"
import { useState } from "react"

interface ChatSidepanelProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    projectSlug: string
    onTaskComplete?: () => void
}

interface Message {
    role: 'user' | 'agent'
    content: string
}

export function ChatSidepanel({ open, onOpenChange, projectSlug, onTaskComplete }: ChatSidepanelProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState("")

    const runTaskMutation = trpc.agent.runTask.useMutation({
        onSuccess: (data) => {
            setMessages(prev => [...prev, { role: 'agent', content: data.output || "Task completed." }])
            onTaskComplete?.()
        },
        onError: (error) => {
            setMessages(prev => [...prev, { role: 'agent', content: `Error: ${error.message}` }])
        }
    })

    const handleSend = () => {
        if (!input.trim() || runTaskMutation.isPending) return

        const task = input
        setInput("")
        setMessages(prev => [...prev, { role: 'user', content: task }])

        runTaskMutation.mutate({ projectSlug, task })
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-[400px] sm:w-[540px] flex flex-col p-0">
                <SheetHeader className="px-6 py-4 border-b">
                    <SheetTitle>Agent Chat</SheetTitle>
                </SheetHeader>

                <ScrollArea className="flex-1 p-6">
                    <div className="flex flex-col gap-4">
                        {messages.length === 0 && (
                            <div className="text-center text-muted-foreground mt-8">
                                <p>Describe a task for the agent to execute.</p>
                                <p className="text-sm">Example: "Change the headline color to blue"</p>
                            </div>
                        )}
                        {messages.map((msg, i) => (
                            <div
                                key={i}
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`rounded-lg px-4 py-2 max-w-[80%] whitespace-pre-wrap ${msg.role === 'user'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted'
                                        }`}
                                >
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                        {runTaskMutation.isPending && (
                            <div className="flex justify-start">
                                <div className="bg-muted rounded-lg px-4 py-2 flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Agent is working...</span>
                                </div>
                            </div>
                        )}
                    </div>
                </ScrollArea>

                <div className="p-4 border-t mt-auto">
                    <div className="flex gap-2">
                        <Input
                            placeholder="Type a task..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            disabled={runTaskMutation.isPending}
                        />
                        <Button onClick={handleSend} disabled={runTaskMutation.isPending || !input.trim()}>
                            <Send className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    )
}
