export interface OpencodeToolContext {
  directory: string;
}

export interface OpencodeToolDefinition {
  description: string;
  args: Record<string, never>;
  execute: (args: Record<string, never>, context: OpencodeToolContext) => Promise<string>;
}
