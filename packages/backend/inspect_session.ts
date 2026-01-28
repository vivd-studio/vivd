import { createOpencodeClient } from "@opencode-ai/sdk";

async function main() {
  try {
    const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" });
    const result = await client.session.list({});
    if (result.error) {
      console.error("Error listing sessions:", result.error);
    } else {
      const sessions = result.data || [];
      if (sessions.length > 0) {
        console.log("Session Structure:", JSON.stringify(sessions[0], null, 2));
      } else {
        console.log("No sessions found.");
      }
    }
  } catch (e) {
    console.error(e);
  }
}

main();
