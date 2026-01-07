import { router } from "../trpc";
import { agentSessionProcedures } from "./agent/sessions";
import { agentChecklistProcedures } from "./agent/checklist";
import { agentSubscriptionProcedures } from "./agent/subscription";

export const agentRouter = router({
  ...agentSessionProcedures,
  ...agentChecklistProcedures,
  ...agentSubscriptionProcedures,
});
