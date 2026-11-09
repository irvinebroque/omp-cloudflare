import { z } from "zod";
import { memorySchema, objectSchema, ApiError, type JsonInput } from "../core/index.ts";
import { archiveSchema, receiptSchema, tombstoneSchema } from "../experimental/index.ts";

export const storeSchema = z.enum(["personal", "company"]);

export const readResponse = z.object({
  memory: memorySchema,
  version: z.string(),
  commit: z.string(),
  dangling_references: z.array(objectSchema).default([]),
});

export const savedResponse = readResponse.extend({ receipts: z.array(receiptSchema) });
export const routedSavedResponse = savedResponse.extend({ routed_to: storeSchema });
export const importedResponse = z.object({ receipts: z.array(receiptSchema), commit: z.string() });

export const deletedResponse = z.object({
  deleted: z.literal(true),
  tombstone: tombstoneSchema,
  commit: z.string(),
});

export const searchResponse = z.object({
  memories: z.array(memorySchema),
  dangling_references: z.array(objectSchema).default([]),
  quarantined_records: z.number().int().nonnegative().default(0),
  next_cursor: z.string().nullable(),
  total: z.number(),
  commit: z.string().nullable(),
});

export const gatewaySearchResponse = z.object({
  memories: z.array(
    z.object({
      store: storeSchema,
      memory: memorySchema,
      commit: z.string().nullable(),
      dangling_references: z.array(objectSchema).default([]),
    }),
  ),
  next_cursor: z.string().nullable(),
  total: z.number(),
  partial: z.boolean(),
  stores: z.array(
    z.object({
      store: storeSchema,
      ok: z.boolean(),
      commit: z.string().nullable().optional(),
      error: z.string().optional(),
    }),
  ),
});

export const exportResponse = archiveSchema.extend({
  next_cursor: z.string().nullable(),
  storage: z.object({ provider: z.string(), repo: z.string(), commit: z.string().nullable() }),
});

export const historyResponse = z.object({
  commits: z.array(
    z.object({ hash: z.string(), message: z.string(), parents: z.array(z.string()) }),
  ),
});

export const storeInfoResponse = z.object({
  store: storeSchema,
  capabilities: z.array(z.string()),
  auth: z.string(),
});

export const gatewayInfoResponse = z.object({
  connected_stores: z.array(storeSchema),
  routing: z.object({ default: storeSchema }),
});

const errorResponse = z.object({ error: z.string() });

/** Validate every JSON response before returning it to callers. */
export async function decodeResponse<S extends z.ZodType>(
  response: Response,
  schema: S,
): Promise<z.output<S>> {
  if (
    response.headers.get("content-type")?.split(";").at(0)?.trim().toLowerCase() !==
    "application/json"
  )
    throw new ApiError(
      response.ok ? 502 : response.status,
      `Expected a JSON memory response; received HTTP ${response.status} (${response.headers.get("content-type") ?? "no content type"})`,
    );
  const payload: JsonInput = objectSchema.parse(await response.json());

  if (!response.ok) {
    const failure = errorResponse.safeParse(payload);
    throw new ApiError(
      response.status,
      failure.success ? failure.data.error : "Memory operation failed",
    );
  }

  return schema.parse(payload);
}

export function requestOptions(data?: JsonInput): RequestInit {
  return data === undefined
    ? {}
    : {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      };
}
