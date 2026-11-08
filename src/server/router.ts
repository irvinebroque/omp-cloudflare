import {
  ApiError,
  archive,
  importedMemories,
  EXPORT_TOMBSTONE_PAGE_SIZE,
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
} from "../protocol/model.ts";
import { mutate, read, STORES } from "../storage/artifacts.ts";
import { pageInput, paginate } from "../protocol/pagination.ts";
import {
  federatedSearch,
  targetStore,
  searchInput,
  searchMemories,
  compareMemories,
} from "./gateway.ts";
import {
  addContribution,
  applicable,
  memoryVersion,
  selectMemory,
  validateContext,
  validateConventions,
} from "../protocol/runtime.ts";

const json = (value: JsonInput, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });

export async function body(request: Request): Promise<Record<string, Json>> {
  if (
    request.headers.get("content-type")?.split(";").at(0)?.trim().toLowerCase() !==
    "application/json"
  )
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

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health")
    return json({ ok: true, storage: "Cloudflare Artifacts" });

  if (request.method === "GET" && url.pathname === "/fmp/info")
    return json({
      name: "OMP on Cloudflare",
      version: "0.1.0",
      draft: "OMP editors v0.5 / experimental FMP binding",
      experimental_binding: "omp-cloudflare-mcp/0.1",
      mcp: "/mcp",
      profiles: ["minimal"],
      auth: "bearer token; single operator",
      stores: STORES,
      gateway: "/gateway/info",
      namespace: "deployment-specific",
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
      auth: "bearer token; single operator",
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
    await read(env.ARTIFACTS, store);
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
      auth: "bearer token",
    });

  if (request.method === "GET" && path === "fmp/read_inferences") {
    const { state, commit } = await read(env.ARTIFACTS, store);

    const input = pageInput({
      limit: EXPORT_TOMBSTONE_PAGE_SIZE,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });

    const chunk = paginate(state.tombstones, input, { commit, store, operation: "export" });

    return json({
      ...archive({
        ...state,
        memories: input.position === undefined ? state.memories : [],
        tombstones: chunk.items,
      }),
      next_cursor: chunk.next_cursor,
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
    const input = searchInput(data);
    const { query, as_of } = input;
    const { state, commit } = await read(env.ARTIFACTS, store);
    const context = data.context === undefined ? undefined : validateContext(data.context);

    const memories = searchMemories(state.memories, query, as_of)
      .filter((m) => context === undefined || applicable(m, context, as_of))
      .toSorted(compareMemories);

    const chunk = paginate(memories, input, { commit, store, context });

    return json({
      memories: chunk.items,
      total: chunk.total,
      next_cursor: chunk.next_cursor,
      commit,
    });
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

    if (!parsed.success)
      throw new ApiError(400, "Invalid supported OMP minimal snapshot/copy archive");
    const { tombstones } = parsed.data;
    const memories = importedMemories(parsed.data);

    const result = await mutate(env.ARTIFACTS, store, "Import OMP snapshot", (state) => ({
      receipts: merge(state, memories, tombstones),
    }));

    return json({ ...result.result, commit: result.commit });
  }

  throw new ApiError(404, "Endpoint not supported");
}
