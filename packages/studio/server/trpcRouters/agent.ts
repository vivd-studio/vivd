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
  CHECKLIST_ITEMS,
  type PrePublishChecklist,
  type ChecklistItem,
} from "../opencode/checklistTypes.js";
import { simpleGit } from "simple-git";
import fs from "fs";
import path from "path";
import {
  getBackendUrl,
  getConnectedOrganizationId,
  getSessionToken,
  getStudioId,
  isConnectedMode,
} from "@vivd/shared";

const CHECKLIST_PENDING_NOTE = "[[PENDING_AGENT_REVIEW]]";
const CONNECTED_CHECKLIST_TOOL_INSTRUCTIONS = `IMPORTANT FOR THIS TASK:
- You MUST use the \`vivd_publish_checklist\` tool to write checklist results incrementally.
- First call the tool with: { "action": "describe" }.
- Then call \`update_item\` once for each checklist item id returned by describe.
- For every \`update_item\` call, provide \`itemId\`, \`status\`, and a concise \`note\`.
- If a tool call returns an error, fix the arguments and retry immediately.
- Ignore any later instruction to return one final JSON checklist blob.
- After all items are updated, reply with a short completion sentence only.`;

function getWorkspaceDir(ctx: { workspace: { isInitialized(): boolean; getProjectPath(): string } }): string {
  if (!ctx.workspace.isInitialized()) {
    throw new Error("Workspace not initialized");
  }
  return ctx.workspace.getProjectPath();
}

function getConnectedChecklistApiConfig():
  | {
      backendUrl: string;
      sessionToken: string;
      studioId: string;
      organizationId?: string;
    }
  | null {
  if (!isConnectedMode()) return null;
  const backendUrl = getBackendUrl();
  const sessionToken = getSessionToken();
  const studioId = getStudioId();
  const organizationId = getConnectedOrganizationId();
  if (!backendUrl || !sessionToken || !studioId) return null;
  return { backendUrl, sessionToken, studioId, organizationId };
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
        ...(config.organizationId
          ? { "x-vivd-organization-id": config.organizationId }
          : {}),
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
        ...(config.organizationId
          ? { "x-vivd-organization-id": config.organizationId }
          : {}),
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

function calculateChecklistSummary(items: ChecklistItem[]): PrePublishChecklist["summary"] {
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  let skipped = 0;
  let fixed = 0;

  for (const item of items) {
    switch (item.status) {
      case "pass":
        passed += 1;
        break;
      case "fail":
        failed += 1;
        break;
      case "warning":
        warnings += 1;
        break;
      case "skip":
        skipped += 1;
        break;
      case "fixed":
        fixed += 1;
        break;
      default:
        break;
    }
  }

  if (fixed > 0) {
    return { passed, failed, warnings, skipped, fixed };
  }

  return { passed, failed, warnings, skipped };
}

function createPendingChecklist(options: {
  projectSlug: string;
  version: number;
  snapshotCommitHash?: string;
}): PrePublishChecklist {
  const items: ChecklistItem[] = CHECKLIST_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    status: "skip",
    note: CHECKLIST_PENDING_NOTE,
  }));

  return {
    projectSlug: options.projectSlug,
    version: options.version,
    runAt: new Date().toISOString(),
    snapshotCommitHash: options.snapshotCommitHash,
    items,
    summary: calculateChecklistSummary(items),
  };
}

function tryParseChecklistFromMessages(messages: any[]): { items: ChecklistItem[] } | null {
  const assistantMessages = messages?.filter(
    (m: { info: { role: string } }) => m.info.role === "assistant"
  );
  if (!assistantMessages || assistantMessages.length === 0) return null;

  const lastMessage = assistantMessages[assistantMessages.length - 1];
  let textContent = "";
  if (lastMessage.parts) {
    for (const part of lastMessage.parts) {
      if (part.type === "text" && part.text) {
        textContent += part.text;
      }
    }
  }
  if (!textContent) return null;

  try {
    const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : textContent.trim();
    const parsed = JSON.parse(jsonStr) as { items?: ChecklistItem[] };
    if (parsed?.items && Array.isArray(parsed.items)) {
      return { items: parsed.items };
    }
  } catch {
    // Ignore parse errors; caller handles retry loop.
  }
  return null;
}

function isChecklistFullyUpdated(checklist: PrePublishChecklist | null): boolean {
  if (!checklist) return false;

  const expectedIds = new Set(CHECKLIST_ITEMS.map((item) => item.id));
  for (const expectedId of expectedIds) {
    const item = checklist.items.find((entry) => entry.id === expectedId);
    if (!item) return false;
    if (item.note === CHECKLIST_PENDING_NOTE) return false;
  }

  return true;
}

function hasPendingChecklistItems(checklist: PrePublishChecklist): boolean {
  return checklist.items.some((item) => item.note === CHECKLIST_PENDING_NOTE);
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
   * Connected mode seeds checklist state in backend and prefers incremental
   * tool-driven item updates; standalone mode keeps local file storage.
   * Legacy JSON parsing remains as fallback for compatibility.
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

        const version = input.version ?? 1;
        const connectedMode = isConnectedMode();

        if (connectedMode) {
          const pendingChecklist = createPendingChecklist({
            projectSlug: input.projectSlug,
            version,
            snapshotCommitHash,
          });
          await upsertChecklistToBackend({
            slug: input.projectSlug,
            version,
            checklist: pendingChecklist,
          });
        }

        const checklistPrompt = connectedMode
          ? `${CONNECTED_CHECKLIST_TOOL_INSTRUCTIONS}
- Use "version": ${version} in every vivd_publish_checklist tool call.

${CHECKLIST_PROMPT}`
          : CHECKLIST_PROMPT;

        const runChecklistSession = async () => {
          // Run the agent with the checklist prompt - always create a new session
          const { sessionId } = await runTask(
            checklistPrompt,
            workspacePath,
            undefined,
            undefined,
            connectedMode
              ? {
                  tools: { vivd_publish_checklist: true },
                }
              : undefined,
          );

          // Wait for completion; connected mode prefers tool-updated backend checklist,
          // with JSON parse kept as fallback for compatibility.
          let attempts = 0;
          const maxAttempts = connectedMode ? 120 : 60;
          let checklistData: { items: ChecklistItem[] } | null = null;
          let sessionCompleted = false;

          while (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            attempts++;

            const messages = await getSessionContent(sessionId, workspacePath);
            if (!checklistData) {
              checklistData = tryParseChecklistFromMessages(messages);
              if (checklistData?.items) {
                console.log(
                  `[PrePublishChecklist] Successfully parsed ${checklistData.items.length} items`
                );
              } else if (!connectedMode) {
                console.log(
                  "[PrePublishChecklist] Waiting for valid JSON response..."
                );
              }
            }

            if (!connectedMode) {
              if (checklistData?.items) {
                sessionCompleted = true;
                break;
              }
              continue;
            }

            const statuses = await getSessionsStatus(workspacePath);
            const sessionStatus = statuses[sessionId];
            if (!sessionStatus || sessionStatus.type === "idle") {
              sessionCompleted = true;
              break;
            }
          }

          if (!sessionCompleted) {
            throw new Error(
              connectedMode
                ? "Checklist task timed out before session completion."
                : "Agent did not return a valid checklist. Please try again."
            );
          }

          return { sessionId, checklistData };
        };

        const { sessionId, checklistData } = await runChecklistSession();

        let checklist: PrePublishChecklist | null = null;
        if (connectedMode) {
          checklist = await getChecklistFromBackend({
            slug: input.projectSlug,
            version,
          });

          if (!isChecklistFullyUpdated(checklist)) {
            console.warn(
              "[PrePublishChecklist] Connected checklist was not fully updated by tool calls; trying JSON fallback."
            );
            checklist = null;
          }
        }

        if (!checklist && checklistData?.items) {
          checklist = {
            projectSlug: input.projectSlug,
            version,
            runAt: new Date().toISOString(),
            snapshotCommitHash,
            items: checklistData.items,
            summary: calculateChecklistSummary(checklistData.items),
          };

          if (connectedMode) {
            await upsertChecklistToBackend({
              slug: input.projectSlug,
              version,
              checklist,
            });
          } else {
            const vivdDir = path.join(workspacePath, ".vivd");
            if (!fs.existsSync(vivdDir)) fs.mkdirSync(vivdDir, { recursive: true });
            const checklistPath = path.join(vivdDir, "publish-checklist.json");
            fs.writeFileSync(checklistPath, JSON.stringify(checklist, null, 2));
          }
        }

        if (!checklist) {
          throw new Error(
            "Checklist run did not produce a valid result. Retry the checklist run."
          );
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

          if (hasPendingChecklistItems(checklist)) {
            hasChangesSinceCheck = true;
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

        if (hasPendingChecklistItems(checklist)) {
          hasChangesSinceCheck = true;
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
