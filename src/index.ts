import { ApiError } from "./protocol/model.ts";
import { authorize } from "./server/auth.ts";
import { handleMcp } from "./server/mcp.ts";
import { route } from "./server/router.ts";

const publicPaths = new Set(["/health", "/fmp/info", "/gateway/info"]);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;

      if (!(request.method === "GET" && publicPaths.has(path)))
        authorize(request, env.MEMORY_API_TOKEN);

      if (path === "/mcp") return await handleMcp(request, env, ctx, (inner) => route(inner, env));

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
