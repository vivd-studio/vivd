import {
  createOpencode,
  createOpencodeClient,
  OpencodeClient,
} from "@opencode-ai/sdk";

let serverUrl: string;

export async function initOpencode() {
  console.log(
    `[OpenCode] Starting internal server with model ${process.env.OPENCODE_MODEL}`
  );
  const opencode = await createOpencode({
    config: { model: process.env.OPENCODE_MODEL },
  });
  console.log(
    `[OpenCode] Server Initialized. Server URL: ${opencode.server.url}`
  );
  serverUrl = opencode.server.url;

  return opencode;
}

export async function runTask(
  task: string,
  cwd: string,
  sessionId?: string
): Promise<{ output: string; sessionId: string }> {
  console.log(
    `[OpenCode] Starting task in ${cwd}: "${task}" (Session: ${
      sessionId || "New"
    })`
  );

  if (!serverUrl) {
    throw new Error("OpenCode server not initialized");
  }

  const client = createOpencodeClient({
    baseUrl: serverUrl,
    directory: cwd,
  });

  const events = await client.event.subscribe();

  (async () => {
    try {
      for await (const event of events.stream) {
        if (event.type === "session.updated") {
          console.log(`[OpenCode] Session updated: ${JSON.stringify(event)}`);
        }
      }
    } catch (e) {
      // console.error("Stream closed", e);
    }
  })();

  try {
    const currentSessionId = await getOrCreateSession(client, cwd, sessionId);
    await sendPrompt(client, currentSessionId, cwd, task);
    const output = await getLastResponse(client, currentSessionId);

    console.log(`[OpenCode Output] ${output}`);
    return { output, sessionId: currentSessionId };
  } catch (error: any) {
    console.error(`[OpenCode] Error:`, error);
    throw new Error(`OpenCode task failed: ${error.message}`);
  }
}

async function getOrCreateSession(
  client: OpencodeClient,
  cwd: string,
  sessionId?: string
): Promise<string> {
  if (sessionId) {
    console.log(
      `[OpenCode] Reusing existing session: ${sessionId} for directory: ${cwd}`
    );
    return sessionId;
  }

  const result = await client.session.create({ query: { directory: cwd } });
  if (result.error)
    throw new Error(
      `Failed to create session: ${JSON.stringify(result.error)}`
    );
  if (!result.data?.id) throw new Error("Session created but no ID returned");

  console.log(
    `[OpenCode] Created new session: ${result.data.id} for directory: ${cwd}`
  );
  return result.data.id;
}

async function sendPrompt(
  client: OpencodeClient,
  sessionId: string,
  cwd: string,
  task: string
): Promise<void> {
  const modelEnv = process.env.OPENCODE_MODEL;
  const [providerID, modelID] = modelEnv.split("/");

  console.log(
    `[OpenCode] Sending prompt to session: ${sessionId} for directory: ${cwd}, with model: ${modelEnv}`
  );
  try {
    const result = await client.session.prompt({
      path: { id: sessionId },
      query: { directory: cwd },
      body: {
        model: { providerID, modelID },
        parts: [{ type: "text", text: task }],
      },
    });
    if (result.error)
      throw new Error(
        `Failed to prompt session: ${JSON.stringify(result.error)}`
      );
  } catch (error: any) {
    console.error(`[OpenCode] Error:`, error);
    throw new Error(`OpenCode task failed: ${error.message}`);
  }

  console.log(`[OpenCode] Prompt sent to session: ${sessionId}`);
}

async function getLastResponse(
  client: OpencodeClient,
  sessionId: string
): Promise<string> {
  const result = await client.session.messages({ path: { id: sessionId } });
  if (result.error)
    throw new Error(
      `Failed to fetch messages: ${JSON.stringify(result.error)}`
    );

  const messages = result.data || [];
  const lastMessage = messages
    .slice()
    .reverse()
    .find((m: any) => m.info?.role === "assistant");

  if (!lastMessage?.parts) return "Task completed (no textual output found)";

  const textParts = lastMessage.parts.filter((p: any) => p.type === "text");
  return textParts.length > 0
    ? textParts.map((p: any) => p.text).join("\n")
    : JSON.stringify(lastMessage.parts);
}
