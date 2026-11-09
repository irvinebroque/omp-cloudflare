import { z } from "zod";

export const conversationId = z.uuid();

export const promptInput = z.object({
  prompt: z.string().trim().min(1).max(8000),
  operationId: z.uuid(),
});

export const chatMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool"]),
  text: z.string(),
});

export const chatView = z.object({
  messages: z.array(chatMessage),
  streaming: z.string(),
  busy: z.boolean(),
  failure: z.string().nullable(),
  earlier: z.boolean(),
});

export type ChatView = z.infer<typeof chatView>;

export type ChatMessage = z.infer<typeof chatMessage>;
