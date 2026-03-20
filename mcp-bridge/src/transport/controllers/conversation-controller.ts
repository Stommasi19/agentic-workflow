import type { DbClient } from "../../db/client.js";
import { getConversations } from "../../application/services/get-conversations.js";
import type { ApiRequest, ApiResponse } from "../types.js";
import { appErr } from "../types.js";
import type { GetConversationsSchema } from "../schemas/conversation-schemas.js";
import type { z } from "zod";
import type { ConversationsResponseSchema } from "../schemas/conversation-schemas.js";

type ConversationsResponse = z.infer<typeof ConversationsResponseSchema>;

export function createConversationController(db: DbClient) {
  return {
    async list(
      req: ApiRequest<GetConversationsSchema>,
    ): Promise<ApiResponse<ConversationsResponse>> {
      const result = getConversations(db, {
        limit: req.query.limit,
        offset: req.query.offset,
      });
      if (!result.ok) return appErr(result.error);
      return { ok: true, data: result.data };
    },
  };
}
