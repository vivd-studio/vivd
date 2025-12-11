import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { trpc } from "@/lib/trpc"
import { Loader2, Send, X } from "lucide-react"
import { useState, useRef, useEffect } from "react"

interface ChatPanelProps {
    projectSlug: string
    onTaskComplete?: () => void
    onClose?: () => void
}

interface Message {
    role: 'user' | 'agent'
    content: string
}

export function ChatPanel({ projectSlug, onTaskComplete, onClose }: ChatPanelProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState("")
    const [sessionId, setSessionId] = useState<string | undefined>(undefined)
    const scrollRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const runTaskMutation = trpc.agent.runTask.useMutation({
        onSuccess: (data) => {
            if (data.sessionId) {
                setSessionId(data.sessionId)
            }
            setMessages(prev => [...prev, { role: 'agent', content: data.output || "Task completed." }])
            onTaskComplete?.()
        },
        onError: (error) => {
            setMessages(prev => [...prev, { role: 'agent', content: `Error: ${error.message}` }])
        }
    })

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages])

    const handleSend = () => {
        if (!input.trim() || runTaskMutation.isPending) return

        const task = input
        setInput("")
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
        setMessages(prev => [...prev, { role: 'user', content: task }])

        runTaskMutation.mutate({ projectSlug, task, sessionId })
    }

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight}px`;
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }

    return (
        <div className="flex flex-col h-full bg-background">
            <div className="px-6 py-4 border-b flex justify-between items-center">
                <h2 className="text-lg font-semibold">Agent Chat</h2>
                {onClose && (
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <span className="sr-only">Close</span>
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>

            <ScrollArea className="flex-1 p-6" ref={scrollRef}>
                <div className="flex flex-col gap-4 pb-4">
                    {messages.length === 0 && (
                        <div className="text-center text-muted-foreground mt-8">
                            <p>Describe a task for the agent to execute.</p>
                            <p className="text-sm mt-2">Example: "Change the headline color to blue"</p>
                        </div>
                    )}
                    {messages.map((msg, i) => (
                        <div
                            key={i}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div
                                className={`rounded-lg px-4 py-2 max-w-[90%] whitespace-pre-wrap ${msg.role === 'user'
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
                <div className="flex gap-2 items-end">
                    <textarea
                        ref={textareaRef}
                        className="flex min-h-[40px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none max-h-[200px]"
                        placeholder="Type a task..."
                        value={input}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        disabled={runTaskMutation.isPending}
                        rows={1}
                    />
                    <Button onClick={handleSend} disabled={runTaskMutation.isPending || !input.trim()} size="icon" className="h-10 w-10 shrink-0">
                        <Send className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        </div>
    )
}
