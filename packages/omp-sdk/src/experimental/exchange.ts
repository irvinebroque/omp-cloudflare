import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  ApiError,
  jsonValue,
  label,
  timestampSchema,
  contributorSchema,
  memorySchema,
  key,
  stable,
  text,
  validateMemory,
  type Memory,
} from "../core/index.ts";
import { danglingReferences, references, rewriteReferences } from "./references.ts";

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
        .optional(),
    })
    .catchall(jsonValue.optional()),
  memories: z.array(memorySchema),
  tombstones: z.array(tombstoneSchema).default([]),
});

export type Archive = z.infer<typeof archiveSchema>;

export const receiptSchema = z.object({
  identifier: label,
  origin: label,
  status: z.enum(["accepted", "unchanged", "rejected"]),
  reason: z.string().optional(),
});

export type Receipt = z.infer<typeof receiptSchema>;

/** Input to the experimental copy envelope, not a prescribed storage schema. */
export interface ExchangeSource {
  origin: string;
  memories: readonly Memory[];
  tombstones: readonly Tombstone[];
}

export function archive(state: ExchangeSource, exportedAt = new Date().toISOString()): Archive {
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
          bytesToHex(sha256(new TextEncoder().encode(key(memory, state.origin) + ":" + suffix)));
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
      exported_at: exportedAt,
      selection: "snapshot",
      intent: "copy",
      media_types: [...new Set(state.memories.map((memory) => memory.media_type))],
      x_omp_identity_map: mapping,
      x_omp_reference_convention: "omp-cloudflare-references/0.1",
      x_omp_dangling_references: danglingReferences(memories, state.origin),
    },
    memories,
    tombstones: [...state.tombstones],
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
