import type { z } from "zod";

export interface OpencodeToolContext {
  directory: string;
}

export interface OpencodeToolDefinition<Args extends z.ZodRawShape = z.ZodRawShape> {
  description: string;
  args: Args;
  execute: (
    args: z.infer<z.ZodObject<Args>>,
    context: OpencodeToolContext,
  ) => Promise<string>;
}
