import type { DbClient } from "../db/client.js";
import { createConversationController } from "../transport/controllers/conversation-controller.js";
import { defineRoute, type ControllerDefinition, type RouteEntry } from "../transport/types.js";
import { GetConversationsSchema } from "../transport/schemas/conversation-schemas.js";

export function createConversationRoutes(db: DbClient): ControllerDefinition {
  const handlers = createConversationController(db);

  return {
    basePath: "/conversations",
    routes: [
      defineRoute({
        method: "GET",
        path: "",
        summary: "List all conversations with message/task counts",
        schema: GetConversationsSchema,
        handler: handlers.list,
      }),
    ] as RouteEntry[],
  };
}
