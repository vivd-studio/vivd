import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Terminal } from "lucide-react";

/**
 * OpencodeDebugPanel is disabled because the opencode API now requires
 * project context for all operations. Use the chat panel within a specific
 * project to interact with sessions.
 */
export function OpencodeDebugPanel() {
  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          OpenCode Agent Debugger
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground text-center py-8">
          <p>This debug panel is currently disabled.</p>
          <p className="text-sm mt-2">
            OpenCode sessions are now per-project. Use the chat panel within a
            specific project to view and manage sessions.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
