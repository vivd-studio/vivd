# Studio Chat And Agent UX Plan

Date: 2026-04-28  
Owner: Studio / product UX  
Status: proposed

## Goal

Make Studio chat feel like a helpful website-building assistant for non-technical customers, not a developer console.

This plan covers two connected surfaces:

- the chat timeline UI in Studio
- the generated instructions that shape how the Studio agent plans, talks, edits, and explains work

It should be implemented alongside, but not mixed into, the lower-level OpenCode sync refactor in [`plans/opencode-chat-refactor-plan.md`](./opencode-chat-refactor-plan.md).

## Problems To Fix

- Agent response blocks have too much left/right padding, which makes ordinary assistant replies feel heavy and wastes space in the chat column.
- Tool calls are too verbose in the message stream. Multiple calls often become a tall stack, even when the useful information is simply that the agent read files, edited files, or ran checks.
- User messages do not stand apart enough from the chat background, especially when scanning a longer session.
- The Studio agent still talks too much like it is speaking to a developer. Normal Vivd users are likely site owners or operators, not engineers.
- Agent instructions are too broad and technical in places. They need to be more precise, concise, and aligned with current product behavior.
- The agent should plan feature work proactively before implementation, because a non-technical user will usually ask for an outcome rather than a structured implementation process.
- CMS guidance in the instructions needs to be checked against the current CMS implementation so the agent does not keep repeating stale or partially wrong rules.

## Product Principles

- The default chat experience should be calm, friendly, and practical.
- Technical detail should be available when useful, but hidden behind compact summaries by default.
- The assistant should communicate outcomes, tradeoffs, and next steps in plain language.
- The assistant should still be autonomous: clarify only when the user's intent is materially ambiguous or risky, otherwise plan internally and move the work forward.
- The assistant should be creative and open in product/design work, while staying precise about what it changed and how the user can review it.

## Workstream 1: Chat Timeline Visual Design

Primary files to inspect first:

- `packages/studio/client/src/components/chat/MessageList.tsx`
- `packages/studio/client/src/components/chat/message-list/AgentMessageRow.tsx`
- `packages/studio/client/src/components/chat/message-list/UserMessageRow.tsx`
- `packages/studio/client/src/components/chat/message-list/chatMarkdown.tsx`
- `packages/studio/client/src/components/chat/ChatPanel.tsx`

Targets:

- Reduce horizontal padding inside agent response blocks while keeping readable line length and enough spacing around code blocks.
- Keep markdown, code, diff previews, and permission/status blocks from becoming cramped after the padding reduction.
- Increase user-message contrast against the chat background in both light and dark themes.
- Give user messages a deliberate background treatment that feels like a message bubble, not a muted paragraph on the page.
- Preserve dense but polished typography. Do not solve the spacing issue by shrinking the text back down.
- Verify responsive behavior in narrow chat widths and the wider resized chat sidebar.

Acceptance criteria:

- A long agent reply reads comfortably without oversized side padding.
- User messages are easy to pick out while scrolling.
- Light and dark themes feel intentionally different, not just the same treatment with inverted colors.
- No message text, inline code, or action buttons overflow their container at narrow widths.

## Workstream 2: Compact Tool Activity

Primary files to inspect first:

- `packages/studio/client/src/features/opencodeChat/render/timeline.ts`
- `packages/studio/client/src/features/opencodeChat/activity.ts`
- `packages/studio/client/src/features/opencodeChat/actionLabels.ts`
- `packages/studio/client/src/components/chat/message-list/AgentMessageRow.tsx`
- `packages/studio/client/src/components/chat/message-list/useWorkedSectionState.ts`

Targets:

- Replace tall per-tool-call stacks with a compact single-line activity summary when multiple low-risk tool calls happen together.
- Group common tool activity into human labels, for example:
  - `Read 4 files`
  - `Edited 2 files`
  - `Searched the project`
  - `Ran checks`
- Keep running, failed, and permission-gated tools visually distinct so important state is not hidden.
- Provide an expandable detail view for exact tool names, file paths, commands, and raw technical detail.
- Avoid exposing raw command/tool vocabulary as the main visible text unless it is the clearest user-facing description.
- Keep permission prompts and destructive actions explicit; do not collapse approval requests into a passive summary.

Acceptance criteria:

- A turn with many read/search/edit calls usually consumes one compact activity row, not many repeated rows.
- Failed checks and blocked approvals remain visible and actionable.
- Technical details are still available for debugging and support.
- Existing tool-label tests cover the grouped labels and fallback behavior.

## Workstream 3: Studio Agent Voice And Workflow

Primary files to inspect first:

- `packages/shared/src/studio/agentInstructions.ts`
- `packages/backend/src/services/agent/AgentInstructionsService.ts`
- `packages/backend/test/agent_instructions_service.test.ts`
- `packages/studio/server/services/agent/AgentInstructionsService.test.ts`

Instruction changes:

- Rewrite the default Studio agent instructions to be shorter and more directive.
- Make the target audience explicit: the user is usually a non-technical site owner, not a developer.
- Tell the agent to use plain, friendly, product-focused language.
- Tell the agent to avoid unnecessary implementation jargon, filenames, command names, and raw error text in the main response.
- Tell the agent to put technical details behind short labels such as `Technical details` only when they matter.
- Tell the agent to infer the user's actual goal before acting.
- Tell the agent to plan feature work before implementing it, even when the user did not ask for a plan.
- Tell the agent to ask one concise clarifying question only when the outcome is genuinely ambiguous, risky, or impossible to infer.
- Tell the agent to proceed autonomously when the intent is clear enough.
- Tell the agent to be creative and open in design/product work while still protecting existing content, data, and site behavior.
- Tell the agent to summarize completed work in user-facing terms first, with validation or technical notes second.

Suggested instruction structure:

1. `Who You Are Helping`
2. `How To Work`
3. `How To Talk`
4. `When To Ask`
5. `Project And CMS Rules`
6. `Validation And Handoff`
7. `Tool/Platform Notes`

Acceptance criteria:

- The default instruction template is materially shorter than the current one.
- Tests assert the important behavior rules without snapshotting large prompt blocks.
- The agent is explicitly guided to plan first, then implement.
- The agent is explicitly guided to speak to non-technical users in friendly, outcome-oriented language.

## Workstream 4: CMS Instruction Accuracy Audit

Primary sources to verify before rewriting CMS guidance:

- `packages/shared/src/cms/`
- `packages/shared/src/studio/agentInstructions.ts`
- `plans/astro-content-collections-plan.md`
- `plans/file-based-cms-spec.md`
- `plans/astro-cms-catalog-asset-ux-plan.md`
- Studio CMS tests under `packages/studio/client/src/components/cms/`
- Studio CMS server/router tests under `packages/studio/server/`

Questions to answer:

- What is the current source of truth for Astro-backed CMS projects?
- Which CMS guidance is active for Astro Content Collections, and which YAML-first guidance is legacy only?
- Which entry formats are currently editable by Studio?
- When should the agent create or edit `src/content.config.ts`?
- When should content become CMS-managed versus remain page/component-owned?
- Which asset roots are correct for CMS-managed media, page-owned media, and passthrough public files?
- What is the correct guidance for Astro `Image` usage, CMS bindings, and raw URL paths?
- Which validation commands are expected before finishing CMS-heavy work?

CMS instruction targets:

- Keep CMS rules short enough that the agent follows them.
- State that Astro-backed projects should use Astro Content Collections as the structured-content source of truth, if that remains accurate after the audit.
- Do not reintroduce legacy YAML-first CMS guidance into active Astro instructions unless the implementation still requires a compatibility note.
- Explain when to use CMS in product terms: repeatable, structured, or customer-managed content.
- Explain when not to use CMS: one-off layout copy, purely decorative sections, or content that is easier and safer to keep in page components.
- Include asset guidance that matches the actual implementation, not just the desired architecture.

Acceptance criteria:

- CMS instructions match the code and tests at the time of implementation.
- Any remaining legacy CMS behavior is labeled as compatibility behavior, not the preferred path.
- The prompt no longer gives broad CMS advice that could cause the agent to model too much content unnecessarily.

## Implementation Phases

### Phase 1: Audit And Design Decisions

- Review the current chat row components, tool timeline rendering, and default agent instruction template.
- Capture before screenshots for light/dark chat states, including long agent replies, multi-tool turns, user messages, failed checks, and permission prompts.
- Verify the CMS implementation and record the current CMS rules before editing the instructions.

### Phase 2: Chat Timeline UI

- Adjust agent/user message spacing and contrast.
- Add compact grouped tool activity rows with expandable details.
- Keep permission, failure, and running states explicit.
- Update focused chat UI tests.

### Phase 3: Instruction Rewrite

- Rewrite the default instruction template around non-technical users, proactive planning, autonomy, and friendly language.
- Keep platform/tool/CMS details concise and accurate.
- Update backend and Studio instruction tests.

### Phase 4: CMS Guidance Verification

- Cross-check the rewritten CMS guidance against implementation tests.
- Add or update a focused test that protects the active CMS guidance from drifting back toward legacy rules.

### Phase 5: Visual And Behavioral Validation

- Run focused Studio client tests for chat rendering.
- Run focused backend/Studio tests for agent instruction rendering.
- Run `npm run typecheck:client -w @vivd/studio` and the relevant backend/shared typechecks if instruction contracts change.
- Use browser screenshots for light/dark chat states before shipping the visual pass.
- If Studio code changes, run `npm run studio:dev:refresh`.

## Not In This Plan

- Replacing the OpenCode sync architecture. That belongs to [`plans/opencode-chat-refactor-plan.md`](./opencode-chat-refactor-plan.md).
- Adding new model capabilities.
- Reworking the whole Studio shell.
- Turning every technical detail into user-facing prose. Some debugging detail should remain available, just not as the default reading path.
