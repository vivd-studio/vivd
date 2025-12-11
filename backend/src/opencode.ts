import { createOpencodeClient } from "@opencode-ai/sdk";

let openCodeServerUrl: string | null = null;
const DEFAULT_URL = "http://localhost:4096";

export function setOpencodeServerUrl(url: string) {
    console.log(`[OpenCode] Server URL set globally to ${url}`);
    openCodeServerUrl = url;
}

export class OpenCodeService {
    /**
     * Runs an OpenCode agent task in the specified working directory.
     * @param task The natural language task description.
     * @param cwd The directory where the agent should operate.
     * @param sessionId Optional session ID to continue a conversation.
     * @returns The output of the agent and the session ID.
     */
    static async runTask(task: string, cwd: string, sessionId?: string): Promise<{ output: string, sessionId: string }> {
        const baseUrl = openCodeServerUrl || DEFAULT_URL;
        console.log(`[OpenCode] Starting task in ${cwd}: "${task}" (Session: ${sessionId || 'New'}) using server ${baseUrl}`);

        // Create a fresh client for each request to avoid state leakage
        const client = createOpencodeClient({
            baseUrl: baseUrl,
        });

        try {
            let currentSessionId = sessionId;

            // 1. Create a session if one doesn't exist
            if (!currentSessionId) {
                // Ensure cwd is absolute? It is gathered from path.join(process.cwd(), ...) so yes.
                const sessionResult = await client.session.create({
                    query: {
                        directory: cwd
                    }
                });

                if (sessionResult.error) {
                    throw new Error(`Failed to create session: ${JSON.stringify(sessionResult.error)}`);
                }

                // sessionResult.data is Session object which has id directly
                if (!sessionResult.data?.id) {
                    throw new Error('Session created but no ID returned');
                }
                currentSessionId = sessionResult.data.id;
                console.log(`[OpenCode] Created new session: ${currentSessionId} for directory: ${cwd}`);
            } else {
                console.log(`[OpenCode] Reusing existing session: ${currentSessionId} for directory: ${cwd}`);
            }

            // 2. Send the task prompt
            // The SDK prompt method sends a message to the session.
            const promptResult = await client.session.prompt({
                path: {
                    id: currentSessionId
                },
                query: {
                    directory: cwd
                },
                body: {
                    parts: [{ type: 'text', text: task }]
                }
            });

            if (promptResult.error) {
                throw new Error(`Failed to prompt session: ${JSON.stringify(promptResult.error)}`);
            }

            // 3. Retrieve the response
            // We need to fetch the messages to get the assistant's response. 
            // The prompt might return it, but listing messages is safer to get the full context if needed.
            // However, usually prompt returns the response. Let's check the data.
            // Assuming promptResult.data contains the new messages or we iterate.

            // For now, let's fetch the last message from the session to be sure.
            const messagesResult = await client.session.messages({
                path: { id: currentSessionId! }
            });

            if (messagesResult.error) {
                throw new Error(`Failed to fetch messages: ${JSON.stringify(messagesResult.error)}`);
            }

            const messages = messagesResult.data || [];
            // Messages structure is Array<{ info: Message, parts: Part[] }>
            // Get the last assistant message
            const lastMessage = messages.slice().reverse().find((m: any) => m.info && m.info.role === 'assistant');

            let output = '';
            if (lastMessage && lastMessage.parts) {
                // Extract text parts
                const textParts = lastMessage.parts.filter((p: any) => p.type === 'text');
                if (textParts.length > 0) {
                    output = textParts.map((p: any) => p.text).join('\n');
                } else {
                    // Fallback to JSON if no text parts (e.g. only tool calls)
                    output = JSON.stringify(lastMessage.parts);
                }
            } else {
                output = "Task completed (no textual output found)";
            }

            // Stream to console to maintain logs
            console.log(`[OpenCode Output] ${output}`);

            return {
                output,
                sessionId: currentSessionId!
            };

        } catch (error: any) {
            console.error(`[OpenCode] Error:`, error);
            throw new Error(`OpenCode task failed: ${error.message}`);
        }
    }
}
