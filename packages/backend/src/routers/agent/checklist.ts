import { adminProcedure } from "../../trpc";
import { z } from "zod";
import { runTask, getSessionContent, getSessionsStatus } from "../../opencode";
import {
  getProjectDir,
  getVersionDir,
  getCurrentVersion,
} from "../../generator/versionUtils";
import { gitService } from "../../services/GitService";
import fs from "fs";
import { CHECKLIST_PROMPT } from "../../opencode/checklistTypes";
import type {
  PrePublishChecklist,
  ChecklistItem,
} from "../../opencode/checklistTypes";
import { debugLog } from "./debug";
import { limitsService } from "../../services/LimitsService";
import { projectMetaService } from "../../services/ProjectMetaService";

export const agentChecklistProcedures = {
  /**
   * Run pre-publish checklist analysis via the agent.
   * The agent analyzes the project and returns a JSON checklist.
   * Results are saved to the database (project_publish_checklist).
   */
  runPrePublishChecklist: adminProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Check usage limits before running checklist (costs LLM tokens)
      await limitsService.assertNotBlocked();

      const projectDir = getProjectDir(input.projectSlug);

      if (!fs.existsSync(projectDir)) {
        throw new Error("Project not found");
      }

      const targetVersion =
        input.version ?? (await getCurrentVersion(input.projectSlug));
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

        // Create a git snapshot before running the checklist
        let snapshotCommitHash: string | undefined;
        try {
          const saveResult = await gitService.save(
            versionPath,
            "Pre-publish checklist snapshot"
          );
          snapshotCommitHash = saveResult.hash;
          console.log(
            `[PrePublishChecklist] Created snapshot commit: ${snapshotCommitHash}`
          );
        } catch (error) {
          console.log(
            "[PrePublishChecklist] No changes to commit, using current HEAD"
          );
          snapshotCommitHash =
            (await gitService.getCurrentCommit(versionPath)) || undefined;
        }

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
          snapshotCommitHash,
          items: checklistData.items,
          summary,
        };

        await projectMetaService.upsertPublishChecklist(checklist);
        console.log(
          `[PrePublishChecklist] Saved checklist to DB for ${input.projectSlug} v${targetVersion}`
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
  getPrePublishChecklist: adminProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        version: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const targetVersion =
        input.version ?? (await getCurrentVersion(input.projectSlug));

      if (targetVersion === 0) {
        return { checklist: null, hasChangesSinceCheck: true };
      }

      const versionPath = getVersionDir(input.projectSlug, targetVersion);
      const checklist = await projectMetaService.getPublishChecklist({
        slug: input.projectSlug,
        version: targetVersion,
      });

      if (!checklist) {
        return { checklist: null, hasChangesSinceCheck: true };
      }

      // Check if there have been changes since the checklist was run
      let hasChangesSinceCheck = true; // Default to true if we can't determine
      if (checklist.snapshotCommitHash) {
        try {
          const currentCommit = await gitService.getCurrentCommit(
            versionPath
          );
          const hasUncommitted = await gitService.hasUncommittedChanges(
            versionPath
          );

          // Changes exist if: current commit differs from snapshot OR there are uncommitted changes
          hasChangesSinceCheck =
            currentCommit !== checklist.snapshotCommitHash || hasUncommitted;
        } catch {
          // If we can't check, assume there are changes to be safe
          hasChangesSinceCheck = true;
        }
      }

      return { checklist, hasChangesSinceCheck };
    }),

  /**
   * Fix a specific checklist item by running an agent task.
   * Similar to runPrePublishChecklist but for fixing individual issues.
   */
  fixChecklistItem: adminProcedure
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
      // Check usage limits before running fix task (costs LLM tokens)
      await limitsService.assertNotBlocked();

      const projectDir = getProjectDir(input.projectSlug);

      if (!fs.existsSync(projectDir)) {
        throw new Error("Project not found");
      }

      const targetVersion =
        input.version ?? (await getCurrentVersion(input.projectSlug));
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

After you fix this issue, respond with ONLY valid JSON:

{"note":"Briefly describe what you changed."}`;

      try {
        console.log(
          `[FixChecklistItem] Fixing item "${input.itemId}" for ${input.projectSlug} v${targetVersion}`
        );

        const existingChecklist = await projectMetaService.getPublishChecklist({
          slug: input.projectSlug,
          version: targetVersion,
        });
        if (!existingChecklist) {
          throw new Error(
            "No checklist found for this version. Run the pre-publish checklist first."
          );
        }

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

        // Extract a note from the agent response (best-effort)
        let fixNote: string | undefined;
        try {
          const messages = await getSessionContent(sessionId, versionPath);
          const assistantMessages = messages?.filter(
            (m: { info: { role: string } }) => m.info.role === "assistant"
          );
          const lastMessage = assistantMessages?.[assistantMessages.length - 1];

          let textContent = "";
          if (lastMessage?.parts) {
            for (const part of lastMessage.parts) {
              if (part.type === "text" && part.text) {
                textContent += part.text;
              }
            }
          }

          const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
          const jsonStr = jsonMatch ? jsonMatch[1].trim() : textContent.trim();
          const parsed = JSON.parse(jsonStr) as { note?: unknown };
          if (typeof parsed.note === "string" && parsed.note.trim()) {
            fixNote = parsed.note.trim();
          }
        } catch {
          // ignore
        }

        const updatedChecklist: PrePublishChecklist = {
          ...existingChecklist,
          items: existingChecklist.items.map((item) => {
            if (item.id !== input.itemId) return item;
            return {
              ...item,
              status: "fixed",
              note: fixNote || item.note || "Fixed by agent",
            };
          }),
          summary: (() => {
            const items = existingChecklist.items.map((item) =>
              item.id === input.itemId
                ? {
                    ...item,
                    status: "fixed" as const,
                    note: fixNote || item.note || "Fixed by agent",
                  }
                : item
            );
            const fixed = items.filter((i) => i.status === "fixed").length;
            return {
              passed: items.filter((i) => i.status === "pass").length,
              failed: items.filter((i) => i.status === "fail").length,
              warnings: items.filter((i) => i.status === "warning").length,
              skipped: items.filter((i) => i.status === "skip").length,
              ...(fixed ? { fixed } : {}),
            };
          })(),
        };

        await projectMetaService.upsertPublishChecklist(updatedChecklist);

        return { success: true, checklist: updatedChecklist, sessionId };
      } catch (error: any) {
        console.error("[FixChecklistItem] Error:", error);
        throw new Error(error.message || "Failed to fix checklist item");
      }
    }),
};
