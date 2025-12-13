import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Loader2, RefreshCw, Terminal, Folder } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function OpencodeDebugPanel() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );

  const {
    data: sessions,
    isLoading: isLoadingSessions,
    refetch: refetchSessions,
    error: sessionError,
  } = trpc.agent.listSessions.useQuery({});

  const {
    data: projects,
    isLoading: isLoadingProjects,
    refetch: refetchProjects,
    error: projectError,
  } = trpc.agent.listProjects.useQuery();

  return (
    <>
      <Card className="mt-8">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            OpenCode Agent Debugger
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchSessions();
              refetchProjects();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="sessions">
            <TabsList>
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
              <TabsTrigger value="projects">Projects</TabsTrigger>
            </TabsList>

            <TabsContent value="sessions" className="space-y-4">
              {isLoadingSessions ? (
                <div className="flex justify-center p-4">
                  <Loader2 className="animate-spin h-6 w-6" />
                </div>
              ) : sessionError ? (
                <div className="text-red-500">
                  Error: {sessionError.message}
                </div>
              ) : (
                <ScrollArea className="h-[400px] border rounded-md p-4">
                  <div className="space-y-4">
                    {sessions?.length === 0 ? (
                      <div className="text-muted-foreground text-center py-4">
                        No active sessions found.
                      </div>
                    ) : (
                      sessions?.map((session: any) => (
                        <div
                          key={session.id}
                          className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0"
                        >
                          <div>
                            <div className="font-medium text-sm">
                              ID: {session.id}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Last Updated:{" "}
                              {new Date(
                                session.updatedAt || Date.now()
                              ).toLocaleString()}
                            </div>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedSessionId(session.id)}
                          >
                            View Content
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>

            <TabsContent value="projects" className="space-y-4">
              {isLoadingProjects ? (
                <div className="flex justify-center p-4">
                  <Loader2 className="animate-spin h-6 w-6" />
                </div>
              ) : projectError ? (
                <div className="text-red-500">
                  Error: {projectError.message}
                </div>
              ) : (
                <ScrollArea className="h-[400px] border rounded-md p-4">
                  <div className="space-y-4">
                    {projects?.length === 0 ? (
                      <div className="text-muted-foreground text-center py-4">
                        No projects found.
                      </div>
                    ) : (
                      projects?.map((project: any) => (
                        <div
                          key={project.id || project.name}
                          className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0"
                        >
                          <div className="flex items-center gap-2">
                            <Folder className="h-4 w-4 text-blue-500" />
                            <span className="font-medium">
                              {project.name || project.id}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {project.path || "No path"}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Sheet
        open={!!selectedSessionId}
        onOpenChange={(open) => !open && setSelectedSessionId(null)}
      >
        <SheetContent className="w-[800px] sm:max-w-[800px]">
          <SheetHeader>
            <SheetTitle>Session Content: {selectedSessionId}</SheetTitle>
            <SheetDescription>
              Full message history for this session.
            </SheetDescription>
          </SheetHeader>
          {selectedSessionId && (
            <SessionContent session_id={selectedSessionId} />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function SessionContent({ session_id }: { session_id: string }) {
  const { data: content, isLoading } = trpc.agent.getSessionContent.useQuery({
    sessionId: session_id,
  });

  if (isLoading)
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="animate-spin h-6 w-6" />
      </div>
    );

  return (
    <ScrollArea className="h-[calc(100vh-100px)] mt-4 border rounded-md p-4 bg-muted/50 font-mono text-xs">
      <pre className="whitespace-pre-wrap">
        {JSON.stringify(content, null, 2)}
      </pre>
    </ScrollArea>
  );
}
