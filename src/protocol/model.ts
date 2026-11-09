import { createHash } from "node:crypto";
import { z } from "zod";

import { jsonValue, objectSchema, type Json, type JsonInput } from "./json.ts";
import { danglingReferences, references, rewriteReferences } from "./references.ts";
import { assertNoCredentials } from "./credentials.ts";
import { ApiError } from "./errors.ts";

export { jsonValue, objectSchema, type Json, type JsonInput } from "./json.ts";
export { ApiError } from "./errors.ts";

export const timestampSchema = z.iso.datetime({ offset: true }).max(64);

const label = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim().length > 0);

export const contributorSchema = z
  .object({
    id: label,
    kind: z.enum(["human", "agent", "system"]),
    contribution: z.string().optional(),
    ai_usage: jsonValue.optional(),
    name: z.string().optional(),
    at: timestampSchema.optional(),
  })
  .catchall(jsonValue);

const referenceSchema = objectSchema;

/** OMP editors' draft v0.5 minimal profile; arbitrary JSON extensions survive parsing. */
export const memorySchema = z
  .object({
    identifier: label,
    media_type: z
      .string()
      .min(1)
      .max(128)
      .regex(
        /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\s*;\s*[a-z0-9!#$&^_.+-]+=(?:[a-z0-9!#$&^_.+-]+|"[^"\r\n]*"))*$/iu,
        "Invalid MIME type",
      ),
    created_at: timestampSchema,
    body: z
      .string()
      .refine((value) => new TextEncoder().encode(value).length <= 16384, "body exceeds 16 KiB"),
    protocol_version: z.string().min(1).max(64).optional(),
    weight: z.number().finite().optional(),
    title: label.optional(),
    path: z.string().max(1024).optional(),
    stub: z.boolean().optional(),
    tags: z.array(z.string().max(128)).max(32).optional(),
    scope: z.array(z.string().max(256)).max(100).optional(),
    version: jsonValue.optional(),
    checksum: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]*:[a-f0-9]+$/iu)
      .optional(),
    provenance: z.array(contributorSchema).max(100).optional(),
    evidence: z.array(z.union([z.string(), referenceSchema])).optional(),
    links: z.array(referenceSchema).optional(),
    status: z.string().optional(),
    updated_at: timestampSchema.optional(),
    valid_from: timestampSchema.optional(),
    valid_until: timestampSchema.optional(),
    x_omp_origin: label.optional(),
  })
  .catchall(jsonValue.optional())
  .refine(
    (memory) =>
      memory.valid_from === undefined ||
      memory.valid_until === undefined ||
      Date.parse(memory.valid_from) < Date.parse(memory.valid_until),
    "valid_until must follow valid_from",
  );

export type Memory = z.infer<typeof memorySchema>;

export const tombstoneSchema = z
  .object({
    origin: label,
    identifier: label,
    deleted_at: timestampSchema,
    provenance: z.array(contributorSchema).optional(),
    reason: z.string().optional(),
  })
  .catchall(jsonValue.optional());

export type Tombstone = z.infer<typeof tombstoneSchema>;

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

export const archiveSchema = z.object({
  manifest: z
    .object({
      protocol_version: z.enum(["0.2", "0.5"]),
      profiles: z.tuple([z.literal("minimal")]),
      origin: label,
      exported_at: timestampSchema,
      selection: z.enum(["snapshot", "selection"]),
      intent: z.literal("copy"),
      media_types: z.array(z.string()),
      x_omp_identity_map: z
        .array(
          z.object({
            exported_identifier: label,
            origin: label,
            identifier: label,
          }),
        )
        .max(100)
        .optional(),
    })
    .catchall(jsonValue.optional()),
  memories: z.array(memorySchema).max(100),
  tombstones: z.array(tombstoneSchema).max(500).default([]),
});

export type Archive = z.infer<typeof archiveSchema>;

export const receiptSchema = z.object({
  identifier: label,
  origin: label,
  status: z.enum(["accepted", "unchanged", "rejected"]),
  reason: z.string().optional(),
});

export type Receipt = z.infer<typeof receiptSchema>;

export function object(value: JsonInput) {
  const result = objectSchema.safeParse(value);

  if (!result.success) throw new ApiError(400, "Expected a JSON object");

  return result.data;
}

export function text(value: JsonInput, name: string, max = 256) {
  const result = z
    .string()
    .min(1)
    .max(max)
    .refine((item) => item.trim().length > 0)
    .safeParse(value);

  if (!result.success)
    throw new ApiError(400, name + " must be a nonempty string of at most " + max + " characters");

  return result.data;
}

export function validateMemory(value: JsonInput): Memory {
  const result = memorySchema.safeParse(value);

  if (!result.success) throw new ApiError(400, z.prettifyError(result.error));

  return result.data;
}

export interface Identity {
  identifier: string;
  x_omp_origin?: string | undefined;
}

export function key(memory: Identity, fallback: string) {
  return JSON.stringify([memory.x_omp_origin ?? fallback, memory.identifier]);
}

function canonical(value: Json): string {
  if (Array.isArray(value)) return "[" + value.map((item) => canonical(item)).join(",") + "]";
  const record = objectSchema.safeParse(value);

  if (record.success)
    return (
      "{" +
      Object.entries(record.data)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([name, item]) => JSON.stringify(name) + ":" + canonical(item))
        .join(",") +
      "}"
    );

  return JSON.stringify(value);
}

/** Canonical JSON ignores absent optional fields, just as persistent JSON does. */
export function stable(value: JsonInput): string {
  return canonical(jsonValue.parse(JSON.parse(JSON.stringify(value) ?? "null")));
}

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
  const counts = new Map<string, number>();

  for (const memory of state.memories)
    counts.set(memory.identifier, (counts.get(memory.identifier) ?? 0) + 1);

  const reserved = new Set(
    state.memories.flatMap((memory) => [
      memory.identifier,
      ...references(memory).map((ref) => ref.target),
    ]),
  );
  const mapping = state.memories.map((memory) => {
    let exported_identifier = memory.identifier;
    if (counts.get(memory.identifier) !== 1) {
      let suffix = 0;
      do {
        exported_identifier =
          "omp-" +
          createHash("sha256")
            .update(key(memory, state.origin) + ":" + suffix)
            .digest("hex");
        suffix++;
      } while (reserved.has(exported_identifier));
      reserved.add(exported_identifier);
    }
    return {
      exported_identifier,
      origin: memory.x_omp_origin ?? state.origin,
      identifier: memory.identifier,
    };
  });

  if (new Set(mapping.map((item) => item.exported_identifier)).size !== mapping.length)
    throw new ApiError(409, "Export identity collision");

  const identities = new Map(
    mapping.map((item) => [
      key({ identifier: item.identifier, x_omp_origin: item.origin }, state.origin),
      item.exported_identifier,
    ]),
  );

  const memories = state.memories.map((memory) => {
    const rewritten = {
      ...rewriteReferences(
        memory,
        (target, origin) =>
          identities.get(
            key({ identifier: target, x_omp_origin: origin ?? memory.x_omp_origin }, state.origin),
          ) ?? target,
      ),
      identifier: text(identities.get(key(memory, state.origin)), "exported identifier"),
    };
    if (memory.checksum !== undefined && stable(memory) !== stable(rewritten))
      throw new ApiError(409, "Cannot remap a checksummed memory; export its origin separately");
    return validateMemory(rewritten);
  });

  return {
    manifest: {
      protocol_version: "0.5",
      profiles: ["minimal"],
      origin: state.origin,
      exported_at: new Date().toISOString(),
      selection: "snapshot",
      intent: "copy",
      media_types: [...new Set(state.memories.map((memory) => memory.media_type))],
      x_omp_identity_map: mapping,
      x_omp_reference_convention: "omp-cloudflare-references/0.1",
      x_omp_dangling_references: danglingReferences(memories, state.origin),
      x_omp_omissions: {
        quarantined_records: state.quarantined?.length ?? 0,
        reason: "invalid_standard_metadata",
      },
    },
    memories,
    tombstones: state.tombstones,
  };
}

/** Restore our explicit identity mapping; generic OMP readers still get unique export IDs. */
export function importedMemories(snapshot: Archive): Memory[] {
  const identifiers = new Set(snapshot.memories.map((memory) => memory.identifier));

  if (identifiers.size !== snapshot.memories.length)
    throw new ApiError(400, "Duplicate identifiers in export");
  const mapping = snapshot.manifest.x_omp_identity_map;

  if (mapping === undefined)
    return snapshot.memories.map((memory) => ({
      ...memory,
      x_omp_origin: memory.x_omp_origin ?? snapshot.manifest.origin,
    }));
  const byExport = new Map(mapping.map((item) => [item.exported_identifier, item]));

  const originalKeys = new Set(
    mapping.map((item) =>
      key({ identifier: item.identifier, x_omp_origin: item.origin }, snapshot.manifest.origin),
    ),
  );

  if (
    mapping.length !== identifiers.size ||
    byExport.size !== mapping.length ||
    originalKeys.size !== mapping.length ||
    mapping.some((item) => !identifiers.has(item.exported_identifier))
  )
    throw new ApiError(400, "Invalid export identity mapping");

  return snapshot.memories.map((memory) => {
    const identity = byExport.get(memory.identifier);

    if (
      identity === undefined ||
      (memory.x_omp_origin !== undefined && memory.x_omp_origin !== identity.origin)
    )
      throw new ApiError(400, "Inconsistent export identity mapping");

    return {
      ...rewriteReferences(memory, (target) => byExport.get(target)?.identifier ?? target),
      identifier: identity.identifier,
      x_omp_origin: identity.origin,
    };
  });
}
