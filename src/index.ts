import {
  ApiError,
  archive,
  key,
  merge,
  object,
  text,
  archiveSchema,
  objectSchema,
  jsonValue,
  type JsonInput,
  type Json,
  validateMemory,
} from "./model.ts";
import { mutate, read, STORES } from "./storage.ts";
import { page } from "./page.ts";
import { federatedSearch, targetStore, searchInput, searchMemories } from "./gateway.ts";
import {
  addContribution,
  applicable,
  memoryVersion,
  selectMemory,
  validateContext,
  validateConventions,
} from "./runtime.ts";
import { handleMcp } from "./mcp.ts";

const json = (value: JsonInput, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });

async function body(request: Request): Promise<Record<string, Json>> {
  if (request.headers.get("content-type")?.includes("application/json") !== true)
    throw new ApiError(415, "Use application/json");

  if (request.body === null) throw new ApiError(400, "JSON body required");
  let size = 0;

  const limited = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;

        if (size > 1048576) throw new ApiError(413, "Request limit: 1 MiB");
        controller.enqueue(chunk);
      },
    }),
  );

  const bytes = await new Response(limited).arrayBuffer();

  try {
    return objectSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Invalid JSON");
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/")
    return new Response(page, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
        "x-content-type-options": "nosniff",
      },
    });

  if (request.method === "GET" && url.pathname === "/health")
    return json({ ok: true, storage: "Cloudflare Artifacts" });

  if (request.method === "GET" && url.pathname === "/fmp/info")
    return json({
      name: "OMP on Cloudflare",
      version: "0.2.0",
      draft: "OMP editors v0.2 / FMP proposal",
      experimental_binding: "omp-cloudflare-mcp/0.1",
      mcp: "/mcp",
      profiles: ["minimal"],
      auth: "none (public prototype)",
      stores: STORES,
      gateway: "/gateway/info",
      namespace: "ompi-memory-prototype",
      storage: "Cloudflare Artifacts Git repositories",
      capabilities: [
        "remember",
        "read",
        "search",
        "update",
        "delete",
        "export",
        "import",
        "history",
        "mcp",
        "conditional-update",
        "runtime-applicability",
      ],
      unsupported: [
        "audit",
        "secure-forget",
        "scope-enforcement",
        "automatic-hooks",
        "realtime-sync",
        "transcripts",
        "files",
        "move",
      ],
    });

  if (request.method === "GET" && url.pathname === "/gateway/info")
    return json({
      name: "OMP memory gateway",
      connected_stores: STORES,
      search: "/gateway/fmp/search",
      write: "/gateway/fmp/upload/inferences",
      routing: { field: "store", default: "personal", allowed: STORES },
      auth: "none (public prototype)",
    });

  if (request.method === "POST" && url.pathname.startsWith("/gateway/fmp/")) {
    const data = await body(request);

    if (url.pathname === "/gateway/fmp/search")
      return json(await federatedSearch(env.ARTIFACTS, data));
    const target = targetStore(data.store);
    const supported = ["upload/inferences", "read", "update", "delete", "import"];
    const operation = url.pathname.slice("/gateway/fmp/".length);

    if (!supported.includes(operation)) throw new ApiError(404, "Gateway endpoint not supported");
    const payload = Object.fromEntries(Object.entries(data).filter(([name]) => name !== "store"));
    const internalUrl = new URL(`/stores/${target}/fmp/${operation}`, url);

    const response = await route(
      new Request(internalUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      env,
    );

    return json(
      { routed_to: target, ...objectSchema.parse(await response.json()) },
      response.status,
    );
  }

  const match = url.pathname.match(/^\/stores\/(personal|company)\/(fmp\/.*|history)$/);

  if (match === null) throw new ApiError(404, "Route not found; see /fmp/info");

  const store = targetStore(match[1]),
    path = match[2];

  if (request.method === "GET" && path === "history") {
    using repo = await env.ARTIFACTS.get(store);

    return json({ commits: jsonValue.parse(await repo.log({ ref: "main", limit: 20 })) });
  }

  if (request.method === "GET" && path === "fmp/info")
    return json({
      store,
      capabilities: [
        "search",
        "read",
        "upload/inferences",
        "read_inferences",
        "delete",
        "import",
        "update",
      ],
      auth: "none",
    });

  if (request.method === "GET" && path === "fmp/read_inferences") {
    const { state, commit } = await read(env.ARTIFACTS, store);

    return json({
      ...archive(state),
      storage: { provider: "cloudflare-artifacts", repo: store, commit },
    });
  }

  if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
  const data = await body(request);

  if (path === "fmp/read") {
    const { state, commit } = await read(env.ARTIFACTS, store);

    const memory = selectMemory(state, {
      identifier: text(data.identifier, "identifier"),
      origin: data.origin === undefined ? undefined : text(data.origin, "origin"),
    });

    if (data.context !== undefined && !applicable(memory, validateContext(data.context)))
      throw new ApiError(404, "Memory is not applicable in this context");

    return json({ memory, version: memoryVersion(memory), commit });
  }

  if (path === "fmp/search") {
    const { query, limit } = searchInput(data);
    const { state, commit } = await read(env.ARTIFACTS, store);
    const context = data.context === undefined ? undefined : validateContext(data.context);

    const memories = searchMemories(state.memories, query).filter(
      (m) => context === undefined || applicable(m, context),
    );

    return json({ memories: memories.slice(0, limit), total: memories.length, commit });
  }

  if (path === "fmp/upload/inferences") {
    let memory = validateMemory({
      identifier: crypto.randomUUID(),
      media_type: "text/plain",
      created_at: new Date().toISOString(),
      ...object(data.memory),
    });

    validateConventions(memory);

    if (data.contributor !== undefined)
      memory = addContribution(memory, text(data.contributor, "contributor"), "authored");

    if (memory.x_omp_origin !== undefined)
      throw new ApiError(400, "Use import to ingest memories from another origin");

    const saved = await mutate(env.ARTIFACTS, store, `Remember ${memory.identifier}`, (state) => ({
      receipts: merge(state, [memory]),
      memory: { ...memory, x_omp_origin: state.origin },
    }));

    return json(
      { ...saved.result, version: memoryVersion(saved.result.memory), commit: saved.commit },
      saved.result.receipts.at(0)?.status === "rejected" ? 409 : 200,
    );
  }

  if (path === "fmp/update") {
    const result = await mutate(env.ARTIFACTS, store, `Update memory`, (state) => {
      const old = selectMemory(state, {
        identifier: text(data.identifier, "identifier"),
        origin: data.origin === undefined ? undefined : text(data.origin, "origin"),
      });

      if (data.context !== undefined && !applicable(old, validateContext(data.context)))
        throw new ApiError(404, "Memory is not applicable in this context");

      if (
        data.if_version !== undefined &&
        text(data.if_version, "if_version") !== memoryVersion(old)
      )
        throw new ApiError(409, "Memory changed; read it again and reconcile before retrying");

      if (old.x_omp_origin !== state.origin)
        throw new ApiError(409, "Imported memories are immutable here; create a new local memory");
      const patch = object(data.patch);

      for (const field of ["identifier", "created_at", "x_omp_origin"])
        if (field in patch) throw new ApiError(400, `Cannot patch ${field}`);
      let memory = validateMemory({ ...old, ...patch, updated_at: new Date().toISOString() });
      validateConventions(memory);

      if (data.contributor !== undefined)
        memory = addContribution(memory, text(data.contributor, "contributor"), "corrected");
      state.memories = state.memories.map((m) =>
        key(m, state.origin) === key(old, state.origin) ? memory : m,
      );
      merge(state, []);

      return { memory, version: memoryVersion(memory) };
    });

    return json({ ...result.result, commit: result.commit });
  }

  if (path === "fmp/delete") {
    const result = await mutate(env.ARTIFACTS, store, "Delete memory", (state) => {
      const identifier = text(data.identifier, "identifier");

      const existing = state.memories.find(
        (m) =>
          m.identifier === identifier &&
          (data.origin === undefined || m.x_omp_origin === data.origin),
      );

      if (existing === undefined) {
        const deleted = state.tombstones.find(
          (t) =>
            t.identifier === identifier && (data.origin === undefined || t.origin === data.origin),
        );

        if (deleted !== undefined) return { deleted: true, tombstone: deleted };
      }

      const m = selectMemory(state, {
        identifier: text(data.identifier, "identifier"),
        origin: data.origin === undefined ? undefined : text(data.origin, "origin"),
      });

      if (data.context !== undefined && !applicable(m, validateContext(data.context)))
        throw new ApiError(404, "Memory is not applicable in this context");

      if (data.if_version !== undefined && text(data.if_version, "if_version") !== memoryVersion(m))
        throw new ApiError(409, "Memory changed; read it again before deleting");

      const tombstone = {
        origin: m.x_omp_origin ?? state.origin,
        identifier: m.identifier,
        deleted_at: new Date().toISOString(),
      };

      merge(state, [], [tombstone]);

      return { deleted: true, tombstone };
    });

    return json({ ...result.result, commit: result.commit });
  }

  if (path === "fmp/import") {
    const parsed = archiveSchema.safeParse(data);

    if (!parsed.success) throw new ApiError(400, "Invalid OMP 0.2 minimal snapshot/copy archive");
    const { manifest, tombstones } = parsed.data;

    const memories = parsed.data.memories.map((memory) => {
      memory.x_omp_origin ??= manifest.origin;

      return memory;
    });

    const result = await mutate(env.ARTIFACTS, store, "Import OMP snapshot", (state) => ({
      receipts: merge(state, memories, tombstones),
    }));

    return json({ ...result.result, commit: result.commit });
  }

  throw new ApiError(404, "Endpoint not supported");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      if (new URL(request.url).pathname === "/mcp")
        return await handleMcp(request, env, ctx, (inner) => route(inner, env));

      return await route(request, env);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error(
        JSON.stringify({
          event: "request_failed",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      );

      return json({ error: "Storage operation failed" }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
