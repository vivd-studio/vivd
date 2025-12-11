import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";

type OpencodeClient = ReturnType<typeof createOpencodeClient>;

let client: OpencodeClient | null = null;
let server: any | null = null;

export async function initOpencode(options: any = {}) {
    console.log(`[OpenCode] Starting internal server...`);
    const instance = await createOpencode(options);
    client = instance.client;
    server = instance.server;
    console.log(`[OpenCode] Initialized. Server URL: ${server.url}`);
    return instance;
}

export function getOpencodeClient() {
    if (!client) {
        throw new Error("OpenCode client not initialized. Call initOpencode first.");
    }
    return client;
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
        const client = getOpencodeClient();
        console.log(`[OpenCode] Starting task in ${cwd}: "${task}" (Session: ${sessionId || 'New'})`);

        try {
            const currentSessionId = await this.getOrCreateSession(client, cwd, sessionId);
            await this.sendPrompt(client, currentSessionId, cwd, task);
            const output = await this.getLastResponse(client, currentSessionId);

            console.log(`[OpenCode Output] ${output}`);
            return { output, sessionId: currentSessionId };
        } catch (error: any) {
            console.error(`[OpenCode] Error:`, error);
            throw new Error(`OpenCode task failed: ${error.message}`);
        }
    }

    private static async getOrCreateSession(client: OpencodeClient, cwd: string, sessionId?: string): Promise<string> {
        if (sessionId) {
            console.log(`[OpenCode] Reusing existing session: ${sessionId} for directory: ${cwd}`);
            return sessionId;
        }

        const result = await client.session.create({ query: { directory: cwd } });
        if (result.error) throw new Error(`Failed to create session: ${JSON.stringify(result.error)}`);
        if (!result.data?.id) throw new Error('Session created but no ID returned');

        console.log(`[OpenCode] Created new session: ${result.data.id} for directory: ${cwd}`);
        return result.data.id;
    }

    private static async sendPrompt(client: OpencodeClient, sessionId: string, cwd: string, task: string): Promise<void> {
        const result = await client.session.prompt({
            path: { id: sessionId },
            query: { directory: cwd },
            body: { parts: [{ type: 'text', text: task }] }
        });
        if (result.error) throw new Error(`Failed to prompt session: ${JSON.stringify(result.error)}`);
    }

    private static async getLastResponse(client: OpencodeClient, sessionId: string): Promise<string> {
        const result = await client.session.messages({ path: { id: sessionId } });
        if (result.error) throw new Error(`Failed to fetch messages: ${JSON.stringify(result.error)}`);

        const messages = result.data || [];
        const lastMessage = messages.slice().reverse().find((m: any) => m.info?.role === 'assistant');

        if (!lastMessage?.parts) return "Task completed (no textual output found)";

        const textParts = lastMessage.parts.filter((p: any) => p.type === 'text');
        return textParts.length > 0
            ? textParts.map((p: any) => p.text).join('\n')
            : JSON.stringify(lastMessage.parts);
    }
}
