import { z } from "zod";
import { tracked } from "@trpc/server";
import { router, publicProcedure } from "../trpc/trpc.js";
import {
  abortSession,
  agentEventEmitter,
  deleteSession,
  getAvailableModels,
  getSessionContent,
  getSessionsStatus,
  listProjects,
  listSessions,
  revertToUserMessage,
  runTask,
  unrevertSession,
} from "../opencode/index.js";
import { validateModelSelection } from "../opencode/modelConfig.js";
import {
  CHECKLIST_PROMPT,
  type PrePublishChecklist,
  type ChecklistItem,
} from "../opencode/checklistTypes.js";
import { simpleGit } from "simple-git";
import fs from "fs";
import path from "path";
import {
  getBackendUrl,
  getSessionToken,
  getStudioId,
  isConnectedMode,
} from "@vivd/shared";

function getWorkspaceDir(ctx: { workspace: { isInitialized(): boolean; getProjectPath(): string } }): string {
  if (!ctx.workspace.isInitialized()) {
    throw new Error("Workspace not initialized");
  }
  return ctx.workspace.getProjectPath();
}

function getConnectedChecklistApiConfig():
  | { backendUrl: string; sessionToken: string; studioId: string }
  | null {
  if (!isConnectedMode()) return null;
  const backendUrl = getBackendUrl();
  const sessionToken = getSessionToken();
  const studioId = getStudioId();
  if (!backendUrl || !sessionToken || !studioId) return null;
  return { backendUrl, sessionToken, studioId };
}

async function upsertChecklistToBackend(options: {
  slug: string;
  version: number;
  checklist: PrePublishChecklist;
}): Promise<void> {
  const config = getConnectedChecklistApiConfig();
  if (!config) return;

  const response = await fetch(
    `${config.backendUrl}/api/trpc/studioApi.upsertPublishChecklist`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.sessionToken}`,
      },
      body: JSON.stringify({
        studioId: config.studioId,
        slug: options.slug,
        version: options.version,
        checklist: options.checklist,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Failed to persist checklist in backend (${response.status}): ${errorText}`,
    );
  }
}

async function getChecklistFromBackend(options: {
  slug: string;
  version: number;
}): Promise<PrePublishChecklist | null> {
  const config = getConnectedChecklistApiConfig();
  if (!config) return null;

  const queryInput = encodeURIComponent(
    JSON.stringify({
      studioId: config.studioId,
      slug: options.slug,
      version: options.version,
    }),
  );

  const response = await fetch(
    `${config.backendUrl}/api/trpc/studioApi.getPublishChecklist?input=${queryInput}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.sessionToken}`,
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Failed to load checklist from backend (${response.status}): ${errorText}`,
    );
  }

  const body = (await response.json().catch(() => null)) as any;
  const data = body?.result?.data?.json ?? body?.result?.data ?? body;
  return (data?.checklist as PrePublishChecklist | null | undefined) ?? null;
}

export const agentRouter = router({
  getAvailableModels: publicProcedure.query(async () => {
    return getAvailableModels();
  }),

  runTask: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        task: z.string(),
        sessionId: z.string().optional(),
        version: z.number().optional(),
        model: z
          .object({
            provider: z.string(),
            modelId: z.string(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);

      const validatedModel = input.model
        ? validateModelSelection(input.model) ?? input.model
        : undefined;

      const result = await runTask(
        input.task,
        directory,
        input.sessionId,
        validatedModel,
      );

      return { success: true, sessionId: result.sessionId, version: input.version ?? 1 };
    }),

  listSessions: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .query(async ({ ctx }) => {
      const directory = getWorkspaceDir(ctx);
      return await listSessions(directory);
    }),

  listProjects: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .query(async ({ ctx }) => {
      const directory = getWorkspaceDir(ctx);
      return await listProjects(directory);
    }),

  getSessionsStatus: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .query(async ({ ctx }) => {
      const directory = getWorkspaceDir(ctx);
      return await getSessionsStatus(directory);
    }),

  getSessionContent: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);
      return await getSessionContent(input.sessionId, directory);
    }),

  deleteSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);
      await deleteSession(input.sessionId, directory);
      return { success: true };
    }),

  revertToMessage: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        messageId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);
      const result = await revertToUserMessage(
        input.sessionId,
        input.messageId,
        directory,
      );
      return { success: true, ...result };
    }),

  unrevertSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);
      await unrevertSession(input.sessionId, directory);
      return { success: true };
    }),

  abortSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        version: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const directory = getWorkspaceDir(ctx);
      await abortSession(input.sessionId, directory);
      return { success: true };
    }),

  sessionEvents: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        lastEventId: z.string().optional(),
      }),
    )
    .subscription(async function* ({ input, signal }) {
      const eventStream = agentEventEmitter.createSessionStream(
        input.sessionId,
        signal,
        input.lastEventId,
      );

      for await (const event of eventStream) {
        yield tracked(event.eventId, event);
      }
    }),

  /**
   * Run pre-publish checklist analysis via the agent.
   * The agent analyzes the project and returns a JSON checklist.
   * Connected mode persists checklist to backend DB; standalone mode keeps local file storage.
   */
  runPrePublishChecklist: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const workspacePath = getWorkspaceDir(ctx);
      const git = simpleGit(workspacePath);

      try {
        console.log(`[PrePublishChecklist] Running checklist for workspace`);

        // Create a git snapshot before running the checklist (auto-save)
        let snapshotCommitHash: string | undefined;
        try {
          const commitHash = await ctx.workspace.commit(
            "Pre-publish checklist snapshot"
          );
          if (commitHash) {
            snapshotCommitHash = commitHash;
            console.log(
              `[PrePublishChecklist] Created snapshot commit: ${snapshotCommitHash}`
            );
          } else {
            const log = await git.log({ maxCount: 1 });
            snapshotCommitHash = log.latest?.hash;
            console.log(
              "[PrePublishChecklist] No changes to commit, using current HEAD"
            );
          }
        } catch (error) {
          console.log("[PrePublishChecklist] Git snapshot error:", error);
          const log = await git.log({ maxCount: 1 });
          snapshotCommitHash = log.latest?.hash;
        }

        // Run the agent with the checklist prompt - always create a new session
        const { sessionId } = await runTask(CHECKLIST_PROMPT, workspacePath);

        // Wait for the agent to complete and get the session content
        let attempts = 0;
        const maxAttempts = 60; // 60 seconds max wait
        let checklistData: { items: ChecklistItem[] } | null = null;

        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          attempts++;

          const messages = await getSessionContent(sessionId, workspacePath);

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
                console.log(
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
          version: input.version ?? 1,
          runAt: new Date().toISOString(),
          snapshotCommitHash,
          items: checklistData.items,
          summary,
        };

        // In connected mode, DB is the source of truth.
        if (isConnectedMode()) {
          await upsertChecklistToBackend({
            slug: input.projectSlug,
            version: input.version ?? 1,
            checklist,
          });
        }

        // Standalone mode keeps checklist on disk.
        if (!isConnectedMode()) {
          const vivdDir = path.join(workspacePath, ".vivd");
          if (!fs.existsSync(vivdDir)) fs.mkdirSync(vivdDir, { recursive: true });
          const checklistPath = path.join(vivdDir, "publish-checklist.json");
          fs.writeFileSync(checklistPath, JSON.stringify(checklist, null, 2));
        }

        return { success: true, checklist, sessionId };
      } catch (error: any) {
        console.error("[PrePublishChecklist] Error:", error);
        throw new Error(error.message || "Failed to run pre-publish checklist");
      }
    }),

  /**
   * Get the saved pre-publish checklist for the workspace.
   */
  getPrePublishChecklist: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const workspacePath = getWorkspaceDir(ctx);

      if (isConnectedMode()) {
        try {
          const checklist = await getChecklistFromBackend({
            slug: input.projectSlug,
            version: input.version ?? 1,
          });

          if (!checklist) {
            return { checklist: null, hasChangesSinceCheck: true };
          }

          let hasChangesSinceCheck = true;
          if (checklist.snapshotCommitHash) {
            try {
              const git = simpleGit(workspacePath);
              const log = await git.log({ maxCount: 1 });
              const currentCommit = log.latest?.hash;
              const hasUncommitted = await ctx.workspace.hasChanges();
              hasChangesSinceCheck =
                currentCommit !== checklist.snapshotCommitHash || hasUncommitted;
            } catch {
              hasChangesSinceCheck = true;
            }
          }

          return { checklist, hasChangesSinceCheck };
        } catch (error) {
          console.warn("[PrePublishChecklist] Backend checklist read failed:", error);
          return { checklist: null, hasChangesSinceCheck: true };
        }
      }

      const checklistPath = path.join(
        workspacePath,
        ".vivd",
        "publish-checklist.json"
      );

      if (!fs.existsSync(checklistPath)) {
        return { checklist: null, hasChangesSinceCheck: true };
      }

      try {
        const content = fs.readFileSync(checklistPath, "utf-8");
        const checklist: PrePublishChecklist = JSON.parse(content);

        // Check if there have been changes since the checklist was run
        let hasChangesSinceCheck = true; // Default to true if we can't determine
        if (checklist.snapshotCommitHash) {
          try {
            const git = simpleGit(workspacePath);
            const log = await git.log({ maxCount: 1 });
            const currentCommit = log.latest?.hash;
            const hasUncommitted = await ctx.workspace.hasChanges();

            // Changes exist if: current commit differs from snapshot OR there are uncommitted changes
            hasChangesSinceCheck =
              currentCommit !== checklist.snapshotCommitHash || hasUncommitted;
          } catch {
            // If we can't check, assume there are changes to be safe
            hasChangesSinceCheck = true;
          }
        }

        return { checklist, hasChangesSinceCheck };
      } catch {
        return { checklist: null, hasChangesSinceCheck: true };
      }
    }),

  /**
   * Fix a specific checklist item by running an agent task.
   */
  fixChecklistItem: publicProcedure
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
    .mutation(async ({ input, ctx }) => {
      const workspacePath = getWorkspaceDir(ctx);

      // Build the fix prompt
      const fixPrompt = `Fix the following pre-publish checklist issue:

**${input.itemLabel}** (${input.itemStatus})
${input.itemNote ? `Issue: ${input.itemNote}` : ""}

${isConnectedMode()
  ? `Do NOT edit any checklist file. Only fix the actual project code and assets related to this issue.`
  : `The checklist file is located at \`.vivd/publish-checklist.json\`.

After you fix this issue, please update the checklist file:
1. Find the item with id "${input.itemId}" in the items array
2. Change its status from "${input.itemStatus}" to "fixed"
3. Update the note to briefly describe what you fixed
4. Update the summary counts (decrement ${
      input.itemStatus === "fail" ? "failed" : "warnings"
    }, increment fixed)

This marks the issue as fixed but requiring re-verification. The user can then re-run the full checks to confirm everything is correct.`}`;

      try {
        console.log(
          `[FixChecklistItem] Fixing item "${input.itemId}" for workspace`
        );

        // Run the agent with the fix prompt - always create a new session
        const { sessionId } = await runTask(fixPrompt, workspacePath);

        // Wait for the agent to complete
        let attempts = 0;
        const maxAttempts = 120; // 120 seconds max wait for fixes (they can take longer)
        let completed = false;

        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          attempts++;

          // Check the session status
          const statuses = await getSessionsStatus(workspacePath);
          const sessionStatus = statuses[sessionId];

          console.log(
            `[FixChecklistItem] Attempt ${attempts}, session status: ${sessionStatus?.type}`
          );

          // Session is complete when it's idle (not busy)
          if (!sessionStatus || sessionStatus.type === "idle") {
            // Get the session content to verify it has a response
            const messages = await getSessionContent(sessionId, workspacePath);
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

        let updatedChecklist: PrePublishChecklist | null = null;

        if (isConnectedMode()) {
          const existing = await getChecklistFromBackend({
            slug: input.projectSlug,
            version: input.version ?? 1,
          });
          if (existing) {
            const items = existing.items.map((item) => {
              if (item.id !== input.itemId) return item;
              return {
                ...item,
                status: "fixed" as const,
                note: `Marked as fixed after agent run${input.itemNote ? `: ${input.itemNote}` : ""}`,
              };
            });

            const summary = {
              ...existing.summary,
              failed:
                input.itemStatus === "fail"
                  ? Math.max(0, existing.summary.failed - 1)
                  : existing.summary.failed,
              warnings:
                input.itemStatus === "warning"
                  ? Math.max(0, existing.summary.warnings - 1)
                  : existing.summary.warnings,
              fixed: (existing.summary.fixed ?? 0) + 1,
            };

            updatedChecklist = {
              ...existing,
              runAt: new Date().toISOString(),
              items,
              summary,
            };

            await upsertChecklistToBackend({
              slug: input.projectSlug,
              version: input.version ?? 1,
              checklist: updatedChecklist,
            });
          }
        } else {
          // Standalone mode: read local checklist file.
          const checklistPath = path.join(
            workspacePath,
            ".vivd",
            "publish-checklist.json"
          );
          if (fs.existsSync(checklistPath)) {
            try {
              const content = fs.readFileSync(checklistPath, "utf-8");
              updatedChecklist = JSON.parse(content);
            } catch {
              // Ignore parse errors
            }
          }
        }

        return { success: true, checklist: updatedChecklist, sessionId };
      } catch (error: any) {
        console.error("[FixChecklistItem] Error:", error);
        throw new Error(error.message || "Failed to fix checklist item");
      }
    }),
});
