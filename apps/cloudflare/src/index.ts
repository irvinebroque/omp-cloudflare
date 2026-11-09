import { ApiError } from "./protocol/model.ts";
import { authorize } from "./server/auth.ts";
import { handleMcp } from "./server/mcp.ts";
import { body, route } from "./server/router.ts";
import { conversationId, promptInput } from "./agent/contracts.ts";
import { targetStore } from "./server/gateway.ts";

export { MemoryAgent } from "./agent/memory-agent.ts";

const publicPaths = new Set(["/health", "/fmp/info", "/gateway/info"]);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;

      if (!(request.method === "GET" && publicPaths.has(path)))
        authorize(request, env.MEMORY_API_TOKEN);

      if (path === "/mcp") return await handleMcp(request, env, ctx, (inner) => route(inner, env));

      if (path.startsWith("/api/chat/")) {
        const id = conversationId.safeParse(path.slice("/api/chat/".length));

        if (!id.success) throw new ApiError(400, "A UUID conversation ID is required");
        const url = new URL(request.url);
        const store = targetStore(url.searchParams.get("store") ?? undefined);

        if (request.method !== "GET" && request.method !== "POST")
          throw new ApiError(405, "Use GET or POST for chat");

        if (
          request.method === "POST" &&
          !promptInput.safeParse(await body(request.clone())).success
        )
          throw new ApiError(400, "A prompt (1–8000 characters) and UUID operationId are required");

        return await env.MemoryAgent.getByName(`${store}:${id.data}`).fetch(request);
      }

      return await route(request, env);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;

      if (!(error instanceof ApiError))
        console.error(
          JSON.stringify({
            event: "request_failed",
            message: error instanceof Error ? error.message : "Unknown error",
          }),
        );

      const headers = new Headers({ "cache-control": "no-store" });

      if (status === 401) headers.set("www-authenticate", "Bearer");

      return Response.json(
        { error: error instanceof ApiError ? error.message : "Storage operation failed" },
        { status, headers },
      );
    }
  },
} satisfies ExportedHandler<Env>;
