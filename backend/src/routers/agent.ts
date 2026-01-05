import { router, protectedProcedure, adminProcedure } from "../trpc";
import { z } from "zod";
import { tracked } from "@trpc/server";
import {
  runTask,
  listSessions,
  listProjects,
  getSessionContent,
  deleteSession as deleteSessionFn,
  revertToUserMessage,
  unrevertSession,
  agentEventEmitter,
  getSessionsStatus,
} from "../opencode";
import {
  getProjectDir,
  getVersionDir,
  getCurrentVersion,
} from "../generator/versionUtils";
import fs from "fs";
import path from "path";
import { CHECKLIST_PROMPT } from "../opencode/checklistTypes";
import type {
  PrePublishChecklist,
  ChecklistItem,
} from "../opencode/checklistTypes";

const debugEnabled = process.env.OPENCODE_DEBUG === "true";
const debugLog = (...args: unknown[]) => {
  if (debugEnabled) {
    console.log(...args);
  }
};

export const agentRouter = router({
  runTask: protectedProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        task: z.string(),
        sessionId: z.string().optional(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const projectDir = getProjectDir(input.projectSlug);

      if (!fs.existsSync(projectDir)) {
        throw new Error("Project not found");
      }

      // Determine version and get version-specific path
      const targetVersion =
        input.version ?? getCurrentVersion(input.projectSlug);
      if (targetVersion === 0) {
        throw new Error("No versions found for this project");
      }

      const versionPath = getVersionDir(input.projectSlug, targetVersion);

      if (!fs.existsSync(versionPath)) {
        throw new Error(`Version ${targetVersion} not found for project`);
      }

      try {
        const { sessionId } = await runTask(
          input.task,
          versionPath,
          input.sessionId
        );
        return { success: true, sessionId, version: targetVersion };
      } catch (error: any) {
        console.error("Agent execution error:", error);
        throw new Error(error.message || "Failed to execute agent task");
      }
    }),

  listSessions: adminProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        // Determine version and get version-specific path
        const targetVersion =
          input.version ?? getCurrentVersion(input.projectSlug);
        let directory: string;
        if (targetVersion > 0) {
          directory = getVersionDir(input.projectSlug, targetVersion);
        } else {
          directory = getProjectDir(input.projectSlug);
        }

        const sessions = await listSessions(directory);
        return sessions;
      } catch (error: any) {
        console.error("Failed to list sessions:", error);
        throw new Error(error.message || "Failed to list sessions");
      }
    }),

  listProjects: adminProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const targetVersion =
          input.version ?? getCurrentVersion(input.projectSlug);
        let directory: string;
        if (targetVersion > 0) {
          directory = getVersionDir(input.projectSlug, targetVersion);
        } else {
          directory = getProjectDir(input.projectSlug);
        }
        const projects = await listProjects(directory);
        return projects;
      } catch (error: any) {
        console.error("Failed to list projects:", error);
        throw new Error(error.message || "Failed to list projects");
      }
    }),

  /**
   * Get the status of all sessions.
   * Returns a map of sessionId -> SessionStatus (idle/busy/retry)
   * Used by frontend to determine if a session is actively processing.
   */
  getSessionsStatus: adminProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        // Compute the directory for this project/version
        const targetVersion =
          input.version ?? getCurrentVersion(input.projectSlug);
        let directory: string | undefined;
        if (targetVersion > 0) {
          directory = getVersionDir(input.projectSlug, targetVersion);
        } else {
          directory = getProjectDir(input.projectSlug);
        }

        debugLog(
          "[getSessionsStatus] Fetching status for directory:",
          directory
        );
        const statuses = await getSessionsStatus(directory);
        debugLog(
          "[getSessionsStatus] Statuses:",
          JSON.stringify(statuses, null, 2)
        );
        return statuses;
      } catch (error: any) {
        console.error("Failed to get sessions status:", error);
        throw new Error(error.message || "Failed to get sessions status");
      }
    }),

  getSessionContent: adminProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const targetVersion =
          input.version ?? getCurrentVersion(input.projectSlug);
        let directory: string;
        if (targetVersion > 0) {
          directory = getVersionDir(input.projectSlug, targetVersion);
        } else {
          directory = getProjectDir(input.projectSlug);
        }
        const content = await getSessionContent(input.sessionId, directory);
        return content;
      } catch (error: any) {
        console.error("Failed to get session content:", error);
        throw new Error(error.message || "Failed to get session content");
      }
    }),

  deleteSession: adminProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const targetVersion =
        input.version ?? getCurrentVersion(input.projectSlug);
      let directory: string;
      if (targetVersion > 0) {
        directory = getVersionDir(input.projectSlug, targetVersion);
      } else {
        directory = getProjectDir(input.projectSlug);
      }

      try {
        await deleteSessionFn(input.sessionId, directory);
        return { success: true };
      } catch (error: any) {
        console.error("Failed to delete session:", error);
        throw new Error(error.message || "Failed to delete session");
      }
    }),

  revertToMessage: adminProcedure
    .input(
      z.object({
        sessionId: z.string(),
        messageId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      console.log("[Revert] Attempting to revert to user message:", {
        sessionId: input.sessionId,
        userMessageId: input.messageId,
        projectSlug: input.projectSlug,
      });

      const targetVersion =
        input.version ?? getCurrentVersion(input.projectSlug);
      let directory: string;
      if (targetVersion > 0) {
        directory = getVersionDir(input.projectSlug, targetVersion);
      } else {
        directory = getProjectDir(input.projectSlug);
      }

      try {
        const result = await revertToUserMessage(
          input.sessionId,
          input.messageId,
          directory
        );
        console.log("[Revert] Revert completed:", result);
        return { success: true, ...result };
      } catch (error: any) {
        console.error("[Revert] Failed to revert session:", error);
        throw new Error(error.message || "Failed to revert session");
      }
    }),

  unrevertSession: adminProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      console.log(
        "[Unrevert] Attempting to unrevert session:",
        input.sessionId
      );

      const targetVersion =
        input.version ?? getCurrentVersion(input.projectSlug);
      let directory: string;
      if (targetVersion > 0) {
        directory = getVersionDir(input.projectSlug, targetVersion);
      } else {
        directory = getProjectDir(input.projectSlug);
      }

      try {
        const result = await unrevertSession(input.sessionId, directory);
        console.log("[Unrevert] Unrevert successful, result:", result);
        return { success: true };
      } catch (error: any) {
        console.error("[Unrevert] Failed to unrevert session:", error);
        throw new Error(error.message || "Failed to unrevert session");
      }
    }),

  /**
   * Run pre-publish checklist analysis via the agent.
   * The agent analyzes the project and returns a JSON checklist.
   * Results are saved to .vivd/publish-checklist.json
   */
  runPrePublishChecklist: protectedProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const projectDir = getProjectDir(input.projectSlug);

      if (!fs.existsSync(projectDir)) {
        throw new Error("Project not found");
      }

      const targetVersion =
        input.version ?? getCurrentVersion(input.projectSlug);
      if (targetVersion === 0) {
        throw new Error("No versions found for this project");
      }

      const versionPath = getVersionDir(input.projectSlug, targetVersion);

      if (!fs.existsSync(versionPath)) {
        throw new Error(`Version ${targetVersion} not found for project`);
      }

      try {
        console.log(
          `[PrePublishChecklist] Running checklist for ${input.projectSlug} v${targetVersion}`
        );

        // Run the agent with the checklist prompt - always create a new session
        const { sessionId } = await runTask(CHECKLIST_PROMPT, versionPath);

        // Wait a bit for the agent to complete and then get the session content
        // The agent should respond with JSON only
        let attempts = 0;
        const maxAttempts = 60; // 60 seconds max wait
        let checklistData: { items: ChecklistItem[] } | null = null;

        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          attempts++;

          const messages = await getSessionContent(sessionId, versionPath);

          // Look for the agent's response (assistant message with JSON)
          const assistantMessages = messages?.filter(
            (m: { info: { role: string } }) => m.info.role === "assistant"
          );

          if (assistantMessages && assistantMessages.length > 0) {
            const lastMessage = assistantMessages[assistantMessages.length - 1];

            // Extract text content from the message
            let textContent = "";
            if (lastMessage.parts) {
              for (const part of lastMessage.parts) {
                if (part.type === "text" && part.text) {
                  textContent += part.text;
                }
              }
            }

            // Try to parse JSON from the response
            if (textContent) {
              try {
                // Remove markdown code blocks if present
                const jsonMatch = textContent.match(
                  /```(?:json)?\s*([\s\S]*?)```/
                );
                const jsonStr = jsonMatch
                  ? jsonMatch[1].trim()
                  : textContent.trim();

                checklistData = JSON.parse(jsonStr);
                if (
                  checklistData?.items &&
                  Array.isArray(checklistData.items)
                ) {
                  console.log(
                    `[PrePublishChecklist] Successfully parsed ${checklistData.items.length} items`
                  );
                  break;
                }
              } catch {
                // JSON not ready yet or invalid, continue waiting
                debugLog(
                  "[PrePublishChecklist] Waiting for valid JSON response..."
                );
              }
            }
          }
        }

        if (!checklistData || !checklistData.items) {
          throw new Error(
            "Agent did not return a valid checklist. Please try again."
          );
        }

        // Calculate summary
        const summary = {
          passed: checklistData.items.filter((i) => i.status === "pass").length,
          failed: checklistData.items.filter((i) => i.status === "fail").length,
          warnings: checklistData.items.filter((i) => i.status === "warning")
            .length,
          skipped: checklistData.items.filter((i) => i.status === "skip")
            .length,
        };

        // Build the full checklist object
        const checklist: PrePublishChecklist = {
          projectSlug: input.projectSlug,
          version: targetVersion,
          runAt: new Date().toISOString(),
          items: checklistData.items,
          summary,
        };

        // Save to .vivd/publish-checklist.json
        const vivdDir = path.join(versionPath, ".vivd");
        if (!fs.existsSync(vivdDir)) {
          fs.mkdirSync(vivdDir, { recursive: true });
        }

        const checklistPath = path.join(vivdDir, "publish-checklist.json");
        fs.writeFileSync(checklistPath, JSON.stringify(checklist, null, 2));

        console.log(
          `[PrePublishChecklist] Saved checklist to ${checklistPath}`
        );

        return { success: true, checklist, sessionId };
      } catch (error: any) {
        console.error("[PrePublishChecklist] Error:", error);
        throw new Error(error.message || "Failed to run pre-publish checklist");
      }
    }),

  /**
   * Get the saved pre-publish checklist for a project version.
   */
  getPrePublishChecklist: protectedProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const targetVersion =
        input.version ?? getCurrentVersion(input.projectSlug);

      if (targetVersion === 0) {
        return { checklist: null };
      }

      const versionPath = getVersionDir(input.projectSlug, targetVersion);
      const checklistPath = path.join(
        versionPath,
        ".vivd",
        "publish-checklist.json"
      );

      if (!fs.existsSync(checklistPath)) {
        return { checklist: null };
      }

      try {
        const content = fs.readFileSync(checklistPath, "utf-8");
        const checklist: PrePublishChecklist = JSON.parse(content);
        return { checklist };
      } catch {
        return { checklist: null };
      }
    }),

  /**
   * Fix a specific checklist item by running an agent task.
   * Similar to runPrePublishChecklist but for fixing individual issues.
   */
  fixChecklistItem: protectedProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
        itemId: z.string(),
        itemLabel: z.string(),
        itemStatus: z.enum(["fail", "warning"]),
        itemNote: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const projectDir = getProjectDir(input.projectSlug);

      if (!fs.existsSync(projectDir)) {
        throw new Error("Project not found");
      }

      const targetVersion =
        input.version ?? getCurrentVersion(input.projectSlug);
      if (targetVersion === 0) {
        throw new Error("No versions found for this project");
      }

      const versionPath = getVersionDir(input.projectSlug, targetVersion);

      if (!fs.existsSync(versionPath)) {
        throw new Error(`Version ${targetVersion} not found for project`);
      }

      // Build the fix prompt
      const fixPrompt = `Fix the following pre-publish checklist issue:

**${input.itemLabel}** (${input.itemStatus})
${input.itemNote ? `Issue: ${input.itemNote}` : ""}

The checklist file is located at \`.vivd/publish-checklist.json\`.

After you fix this issue, please update the checklist file:
1. Find the item with id "${input.itemId}" in the items array
2. Change its status from "${input.itemStatus}" to "fixed"
3. Update the note to briefly describe what you fixed
4. Update the summary counts (decrement ${
        input.itemStatus === "fail" ? "failed" : "warnings"
      }, increment fixed)

This marks the issue as fixed but requiring re-verification. The user can then re-run the full checks to confirm everything is correct.`;

      try {
        console.log(
          `[FixChecklistItem] Fixing item "${input.itemId}" for ${input.projectSlug} v${targetVersion}`
        );

        // Run the agent with the fix prompt - always create a new session
        const { sessionId } = await runTask(fixPrompt, versionPath);

        // Wait for the agent to complete
        let attempts = 0;
        const maxAttempts = 120; // 120 seconds max wait for fixes (they can take longer)
        let completed = false;

        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          attempts++;

          // Check the session status
          const statuses = await getSessionsStatus(versionPath);
          const sessionStatus = statuses[sessionId];

          debugLog(
            `[FixChecklistItem] Attempt ${attempts}, session status: ${sessionStatus}`
          );

          // Session is complete when it's idle (not busy)
          if (!sessionStatus || sessionStatus.type === "idle") {
            // Get the session content to verify it has a response
            const messages = await getSessionContent(sessionId, versionPath);
            const assistantMessages = messages?.filter(
              (m: { info: { role: string } }) => m.info.role === "assistant"
            );

            if (assistantMessages && assistantMessages.length > 0) {
              completed = true;
              console.log(
                `[FixChecklistItem] Fix completed for item "${input.itemId}"`
              );
              break;
            }
          }
        }

        if (!completed) {
          throw new Error(
            "Fix task timed out. The agent may still be working. Please check back later."
          );
        }

        // Read the updated checklist to return
        const checklistPath = path.join(
          versionPath,
          ".vivd",
          "publish-checklist.json"
        );
        let updatedChecklist: PrePublishChecklist | null = null;

        if (fs.existsSync(checklistPath)) {
          try {
            const content = fs.readFileSync(checklistPath, "utf-8");
            updatedChecklist = JSON.parse(content);
          } catch {
            // Ignore parse errors
          }
        }

        return { success: true, checklist: updatedChecklist, sessionId };
      } catch (error: any) {
        console.error("[FixChecklistItem] Error:", error);
        throw new Error(error.message || "Failed to fix checklist item");
      }
    }),

  /**
   * SSE subscription for real-time agent session events.
   * Uses tRPC's async generator pattern for SSE support.
   * Clients can reconnect using lastEventId to resume from where they left off.
   */
  sessionEvents: adminProcedure
    .input(
      z.object({
        sessionId: z.string(),
        // Optional: last event ID for resumable streams
        lastEventId: z.string().optional(),
      })
    )
    .subscription(async function* ({ input, signal }) {
      debugLog(
        `[SessionEvents] Client subscribed to session: ${input.sessionId}`
      );

      // Use the event emitter's async generator to yield events
      const eventStream = agentEventEmitter.createSessionStream(
        input.sessionId,
        signal,
        input.lastEventId
      );

      try {
        for await (const event of eventStream) {
          // Use tracked() to enable resumable streams with event IDs
          yield tracked(event.eventId, event);
        }
      } finally {
        debugLog(
          `[SessionEvents] Client unsubscribed from session: ${input.sessionId}`
        );
      }
    }),
});
