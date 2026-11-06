import { z } from "zod";
import { ApiError, type JsonInput, type Memory } from "./model.ts";
import { read, STORES, type Store } from "./storage.ts";
import type { gatewaySearchResponse } from "./contracts.ts";
import { storeSchema } from "./contracts.ts";
import { applicable, validateContext } from "./runtime.ts";

export type GatewayHit = z.infer<typeof gatewaySearchResponse>["memories"][number];

export function targetStore(value?: JsonInput): Store {
  const parsed = storeSchema.default("personal").safeParse(value);

  if (!parsed.success) throw new ApiError(400, "store must be personal or company");

  return parsed.data;
}

export function searchMemories(memories: Memory[], query: string, now = Date.now()): Memory[] {
  const q = query.toLowerCase();

  return memories.filter(
    (m) =>
      (m.valid_from === undefined || Date.parse(m.valid_from) <= now) &&
      (m.valid_until === undefined || Date.parse(m.valid_until) > now) &&
      [m.identifier, m.title ?? "", m.body, m.tags?.join(" ") ?? ""]
        .join("\n")
        .toLowerCase()
        .includes(q),
  );
}

const searchSchema = z.object({
  query: z.string().max(4096).default(""),
  limit: z.number().int().min(1).max(100).default(20),
});

export function searchInput(data: JsonInput) {
  const parsed = searchSchema.safeParse(data);

  if (!parsed.success)
    throw new ApiError(
      400,
      "query must be a string up to 4096 characters and limit an integer from 1 to 100",
    );

  return parsed.data;
}

/** Search every connected store. Keep store attribution even for copied identities. */
export async function federatedSearch(artifacts: Artifacts, data: Record<string, JsonInput>) {
  const { query, limit } = searchInput(data);
  const context = data.context === undefined ? undefined : validateContext(data.context);
  const targets = data.store === undefined ? STORES : [targetStore(data.store)];

  const responses = await Promise.all(
    targets.map(async (store) => {
      try {
        const { state, commit } = await read(artifacts, store);

        const hits: GatewayHit[] = searchMemories(state.memories, query).flatMap((memory) =>
          context === undefined || applicable(memory, context) ? [{ store, memory, commit }] : [],
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
    .toSorted(
      (a, b) =>
        b.memory.created_at.localeCompare(a.memory.created_at) ||
        a.store.localeCompare(b.store) ||
        a.memory.identifier.localeCompare(b.memory.identifier),
    );

  return {
    memories: hits.slice(0, limit),
    total: hits.length,
    partial: responses.some((r) => !r.ok),
    stores: responses.map((r) => ({ store: r.store, ok: r.ok, commit: r.commit, error: r.error })),
  };
}
