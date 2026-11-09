import type { z } from "zod";
import { ApiError, objectSchema, type JsonInput, type Memory } from "../protocol/model.ts";
import { read, STORES, type Store } from "../storage/artifacts.ts";
import type { gatewaySearchResponse } from "@omp-cloudflare/sdk/bindings/omp-cloudflare";
import { storeSchema } from "@omp-cloudflare/sdk/bindings/omp-cloudflare";
import { pageInput, paginate } from "../protocol/pagination.ts";
import { applicable, validateContext } from "../protocol/runtime.ts";
import { currentMemories, danglingReferences } from "@omp-cloudflare/sdk/experimental";

export type GatewayHit = z.infer<typeof gatewaySearchResponse>["memories"][number];

export function targetStore(value?: JsonInput): Store {
  const parsed = storeSchema.default("personal").safeParse(value);

  if (!parsed.success) throw new ApiError(400, "store must be personal or company");

  return parsed.data;
}

export function searchMemories(memories: Memory[], query: string, now = Date.now()): Memory[] {
  const q = query.toLowerCase();

  return currentMemories(memories, now).filter((m) =>
    [m.identifier, m.title ?? "", m.body, m.tags?.join(" ") ?? ""]
      .join("\n")
      .toLowerCase()
      .includes(q),
  );
}

export const searchInput = pageInput;

/** Always-active memories precede ordinary matches, then newest first with identity tie breakers. */
const always = (memory: Memory) =>
  objectSchema.safeParse(memory.activation).data?.mode === "always" ? 1 : 0;

export function compareMemories(a: Memory, b: Memory) {
  return (
    always(b) - always(a) ||
    Date.parse(b.created_at) - Date.parse(a.created_at) ||
    (a.x_omp_origin ?? "").localeCompare(b.x_omp_origin ?? "") ||
    a.identifier.localeCompare(b.identifier)
  );
}

/** Search every connected store. Keep store attribution even for copied identities. */
export async function federatedSearch(artifacts: Artifacts, data: Record<string, JsonInput>) {
  const input = searchInput(data);
  const { query, as_of } = input;
  const context = validateContext(data.context ?? {});
  const targets = data.store === undefined ? STORES : [targetStore(data.store)];

  const responses = await Promise.all(
    targets.map(async (store) => {
      try {
        const { state, commit } = await read(artifacts, store);

        const diagnostics = danglingReferences(state.memories, state.origin);
        const hits: GatewayHit[] = searchMemories(state.memories, query, as_of).flatMap((memory) =>
          applicable(memory, context, as_of)
            ? [
                {
                  store,
                  memory,
                  commit,
                  dangling_references: diagnostics.filter(
                    (item) =>
                      item.identifier === memory.identifier && item.origin === memory.x_omp_origin,
                  ),
                },
              ]
            : [],
        );

        return { store, ok: true, commit, hits };
      } catch {
        const hits: GatewayHit[] = [];

        return { store, ok: false, error: "Store unavailable", hits };
      }
    }),
  );

  if (responses.every((r) => !r.ok))
    throw new ApiError(503, "All connected memory stores are unavailable");

  const hits = responses
    .flatMap((r) => r.hits)
    .toSorted((a, b) => compareMemories(a.memory, b.memory) || a.store.localeCompare(b.store));

  const stores = responses.map((r) => ({
    store: r.store,
    ok: r.ok,
    commit: r.commit,
    error: r.error,
  }));

  const page = paginate(hits, input, { stores, context, targets });

  return {
    memories: page.items,
    total: page.total,
    next_cursor: page.next_cursor,
    partial: responses.some((r) => !r.ok),
    stores,
  };
}
