import { z } from "zod";

export const jsonValue = z.json();

export type Json = z.infer<typeof jsonValue>;

export type JsonInput =
  | Json
  | undefined
  | { readonly [key: string]: JsonInput }
  | readonly JsonInput[];

export const objectSchema = z.record(z.string(), jsonValue);

export const timestampSchema = z
  .string()
  .max(64)
  .regex(/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/u)
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");

const label = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim().length > 0);

/** OMP editors' draft v0.2 minimal profile; arbitrary JSON extensions survive parsing. */
export const memoryFieldsSchema = z
  .object({
    identifier: label,
    media_type: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => value.trim().length > 0),
    created_at: timestampSchema,
    body: z
      .string()
      .refine((value) => new TextEncoder().encode(value).length <= 16384, "body exceeds 16 KiB"),
    title: label.optional(),
    tags: z.array(z.string().max(128)).max(32).optional(),
    valid_from: timestampSchema.optional(),
    valid_until: timestampSchema.optional(),
    x_omp_origin: label.optional(),
  })
  .catchall(jsonValue);

export const memorySchema = memoryFieldsSchema.refine(
  (memory) =>
    memory.valid_from === undefined ||
    memory.valid_until === undefined ||
    Date.parse(memory.valid_from) < Date.parse(memory.valid_until),
  "valid_until must follow valid_from",
);

export type Memory = z.infer<typeof memorySchema>;

export const tombstoneSchema = z.object({
  origin: label,
  identifier: label,
  deleted_at: timestampSchema,
});

export type Tombstone = z.infer<typeof tombstoneSchema>;

export const stateSchema = z.object({
  origin: label,
  memories: z.array(memorySchema).max(100),
  tombstones: z.array(tombstoneSchema).max(500),
});

export type State = z.infer<typeof stateSchema>;

export const archiveSchema = z.object({
  manifest: z.object({
    protocol_version: z.literal("0.2"),
    profiles: z.tuple([z.literal("minimal")]),
    origin: label,
    exported_at: timestampSchema,
    selection: z.literal("snapshot"),
    intent: z.literal("copy"),
    media_types: z.array(z.string()),
  }),
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

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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

export function timestamp(value: JsonInput, name: string) {
  const result = timestampSchema.safeParse(value);

  if (!result.success)
    throw new ApiError(400, name + " must be an ISO 8601 timestamp with timezone");

  return result.data;
}

export function validateMemory(value: JsonInput): Memory {
  const result = memorySchema.safeParse(value);

  if (!result.success) throw new ApiError(400, z.prettifyError(result.error));

  return result.data;
}

export interface Identity {
  identifier: string;
  x_omp_origin?: string;
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

  if (all.size > 100 || deleted.size > 500)
    throw new ApiError(413, "Prototype limit: 100 memories and 500 tombstones per store");
  state.memories = [...all.values()];
  state.tombstones = [...deleted.values()];

  if (new TextEncoder().encode(JSON.stringify(state)).length > 524288)
    throw new ApiError(413, "Prototype store limit: 512 KiB");

  return receipts;
}

export function archive(state: State): Archive {
  return {
    manifest: {
      protocol_version: "0.2",
      profiles: ["minimal"],
      origin: state.origin,
      exported_at: new Date().toISOString(),
      selection: "snapshot",
      intent: "copy",
      media_types: [...new Set(state.memories.map((memory) => memory.media_type))],
    },
    memories: state.memories,
    tombstones: state.tombstones,
  };
}
