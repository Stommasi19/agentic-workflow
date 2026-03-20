import { z } from "zod";

// ── Response shapes ───────────────────────────────────────

export const ConversationSummarySchema = z.object({
  conversation: z.string().uuid(),
  message_count: z.number().int(),
  task_count: z.number().int(),
  last_activity: z.string(),
});

export const ConversationsResponseSchema = z.object({
  conversations: z.array(ConversationSummarySchema),
  total: z.number().int(),
});

// ── GET /conversations ────────────────────────────────────

export const GetConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GetConversationsSchema = {
  querystring: GetConversationsQuerySchema,
  response: ConversationsResponseSchema,
} as const;
export type GetConversationsSchema = typeof GetConversationsSchema;
