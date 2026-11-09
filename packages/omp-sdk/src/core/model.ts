import { z } from "zod";
import { jsonValue, objectSchema, type Json, type JsonInput } from "./json.ts";
import { OmpError } from "./errors.ts";

export const timestampSchema = z.iso.datetime({ offset: true });

export const label = z
  .string()
  .min(1)
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
      .regex(
        /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:[\t ]*;[\t ]*[a-z0-9!#$%&'*+.^_`|~-]+=(?:[a-z0-9!#$%&'*+.^_`|~-]+|"(?:[\t\x20\x21\x23-\x5b\x5d-\x7e\x80-\xff]|\\[\t\x20-\x7e\x80-\xff])*"))*$/iu,
        "Invalid MIME type",
      ),
    created_at: timestampSchema,
    body: z.string(),
    protocol_version: z.string().min(1).optional(),
    weight: z.number().finite().optional(),
    title: label.optional(),
    path: z.string().optional(),
    stub: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    scope: z.array(z.string()).optional(),
    version: jsonValue.optional(),
    checksum: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]*:[a-f0-9]+$/iu)
      .optional(),
    provenance: z.array(contributorSchema).optional(),
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

export function object(value: JsonInput) {
  const result = objectSchema.safeParse(value);

  if (!result.success) throw new OmpError("invalid_input", "Expected a JSON object");

  return result.data;
}

export function text(value: JsonInput, name: string, max = Number.MAX_SAFE_INTEGER) {
  const result = z
    .string()
    .min(1)
    .max(max)
    .refine((item) => item.trim().length > 0)
    .safeParse(value);

  if (!result.success)
    throw new OmpError(
      "invalid_input",
      name + " must be a nonempty string of at most " + max + " characters",
    );

  return result.data;
}

export function validateMemory(value: JsonInput): Memory {
  const result = memorySchema.safeParse(value);

  if (!result.success) throw new OmpError("invalid_input", z.prettifyError(result.error));

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
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
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
