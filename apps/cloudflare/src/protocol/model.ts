import { ApiError } from "./errors.ts";
import { z } from "zod";
import {
  memorySchema as portableMemorySchema,
  contributorSchema,
  timestampSchema,
  label as portableLabel,
  jsonValue,
  objectSchema,
  key,
  stable,
  text as portableText,
  type JsonInput,
  type Memory,
} from "omp-sdk/core";
import {
  archive as createArchive,
  archiveSchema as portableArchiveSchema,
  tombstoneSchema,
  type Archive,
  type Receipt,
  type Tombstone,
} from "omp-sdk/experimental";
import { assertNoCredentials } from "./credentials.ts";

export * from "omp-sdk/core";
export {
  importedMemories,
  type Archive,
  type Receipt,
  type Tombstone,
  tombstoneSchema,
} from "omp-sdk/experimental";

const label = portableLabel.max(256);
export const text = (value: JsonInput, name: string, max = 256) => portableText(value, name, max);

/** Deployment resource limits are separate from the portable memory schema. */
export const memorySchema = portableMemorySchema.safeExtend({
  identifier: label,
  media_type: portableMemorySchema.shape.media_type.max(128),
  created_at: timestampSchema.max(64),
  body: z
    .string()
    .refine((value) => new TextEncoder().encode(value).length <= 16384, "body exceeds 16 KiB"),
  protocol_version: z.string().min(1).max(64).optional(),
  title: label.optional(),
  path: z.string().max(1024).optional(),
  tags: z.array(z.string().max(128)).max(32).optional(),
  scope: z.array(z.string().max(256)).max(100).optional(),
  provenance: z
    .array(contributorSchema.extend({ id: label, at: timestampSchema.max(64).optional() }))
    .max(100)
    .optional(),
  updated_at: timestampSchema.max(64).optional(),
  valid_from: timestampSchema.max(64).optional(),
  valid_until: timestampSchema.max(64).optional(),
  x_omp_origin: label.optional(),
});

export function validateMemory(value: JsonInput): Memory {
  const parsed = memorySchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, z.prettifyError(parsed.error));
  return parsed.data;
}

export const stateSchema = z.object({
  origin: label,
  memories: z.array(memorySchema).max(100),
  tombstones: z.array(tombstoneSchema),
  quarantined: z.array(jsonValue).optional(),
});

export type State = z.infer<typeof stateSchema>;

const storedStateSchema = stateSchema.extend({ memories: z.array(jsonValue).max(100) });

/** Earlier versions accepted malformed named fields. Keep those records intact, outside the typed memory view. */
export function decodeState(value: unknown): State {
  const stored = storedStateSchema.parse(value);
  const memories: Memory[] = [];
  const quarantined = [...(stored.quarantined ?? [])];
  for (const item of stored.memories) {
    const parsed = memorySchema.safeParse(item);
    if (parsed.success) memories.push(parsed.data);
    else quarantined.push(item);
  }
  return { ...stored, memories, ...(quarantined.length === 0 ? {} : { quarantined }) };
}

// Keeps even worst-case escaped identifiers plus 512 KiB of active memories below the 1 MiB import limit.
export const EXPORT_TOMBSTONE_PAGE_SIZE = 50;

export const archiveSchema = portableArchiveSchema.extend({
  memories: z.array(memorySchema).max(100),
  tombstones: z.array(tombstoneSchema).max(500).default([]),
});

export function merge(
  state: State,
  memories: readonly Memory[],
  tombstones: readonly Tombstone[] = [],
): Receipt[] {
  const all = new Map(state.memories.map((memory) => [key(memory, state.origin), memory]));

  const deleted = new Map(
    state.tombstones.map((item) => [
      key({ identifier: item.identifier, x_omp_origin: item.origin }, state.origin),
      item,
    ]),
  );
  const quarantined = new Set(
    (state.quarantined ?? []).flatMap((value) => {
      const parsed = objectSchema.safeParse(value);
      if (!parsed.success || typeof parsed.data.identifier !== "string") return [];
      const origin = parsed.data.x_omp_origin;
      return [
        key(
          {
            identifier: parsed.data.identifier,
            x_omp_origin: typeof origin === "string" ? origin : state.origin,
          },
          state.origin,
        ),
      ];
    }),
  );

  for (const item of tombstones) {
    const identity = key({ identifier: item.identifier, x_omp_origin: item.origin }, state.origin);
    deleted.set(identity, item);
    all.delete(identity);
  }

  const receipts = memories.map((memory): Receipt => {
    const item = { ...memory, x_omp_origin: memory.x_omp_origin ?? state.origin };
    const identity = key(item, state.origin);
    const origin = item.x_omp_origin;

    if (deleted.has(identity))
      return {
        identifier: item.identifier,
        origin,
        status: "rejected",
        reason: "deleted_identity",
      };
    if (quarantined.has(identity))
      return {
        identifier: item.identifier,
        origin,
        status: "rejected",
        reason: "quarantined_identity; repair the original record before reusing its identity",
      };
    const previous = all.get(identity);

    if (previous !== undefined && stable(previous) !== stable(item))
      return {
        identifier: item.identifier,
        origin,
        status: "rejected",
        reason: "identity_conflict; use update for a local memory",
      };
    all.set(identity, item);

    return {
      identifier: item.identifier,
      origin,
      status: previous === undefined ? "accepted" : "unchanged",
    };
  });

  if (all.size > 100) throw new ApiError(413, "Prototype limit: 100 active memories per store");
  state.memories = [...all.values()];
  state.tombstones = [...deleted.values()];

  if (new TextEncoder().encode(JSON.stringify(state.memories)).length > 524288)
    throw new ApiError(413, "Prototype active memory limit: 512 KiB");

  return receipts;
}

export function archive(state: State): Archive {
  assertNoCredentials({ memories: state.memories, tombstones: state.tombstones });
  const snapshot = createArchive(state);
  snapshot.memories.forEach(validateMemory);
  return {
    ...snapshot,
    manifest: {
      ...snapshot.manifest,
      x_omp_omissions: {
        quarantined_records: state.quarantined?.length ?? 0,
        reason: "invalid_standard_metadata",
      },
    },
  };
}

export { ApiError } from "./errors.ts";
