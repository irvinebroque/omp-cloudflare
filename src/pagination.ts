import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError, stable, type JsonInput } from "./model.ts";

const cursorSchema = z.object({
  offset: z.number().int().min(1),
  fingerprint: z.string().length(64),
  as_of: z.number().int().min(0),
});

const inputSchema = z.object({
  query: z.string().max(4096).default(""),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(4096).optional(),
});

export function pageInput(data: JsonInput) {
  const input = inputSchema.safeParse(data);

  if (!input.success) throw new ApiError(400, "Invalid query, limit (1–100), or cursor");

  try {
    const cursor =
      input.data.cursor === undefined
        ? undefined
        : cursorSchema.parse(
            JSON.parse(Buffer.from(input.data.cursor, "base64url").toString("utf8")),
          );

    return { ...input.data, position: cursor, as_of: cursor?.as_of ?? Date.now() };
  } catch {
    throw new ApiError(400, "Invalid cursor");
  }
}

/** Reject changed snapshots rather than silently skipping or duplicating results between pages. */
export function paginate<T>(
  items: readonly T[],
  input: ReturnType<typeof pageInput>,
  snapshot: JsonInput,
) {
  const fingerprint = createHash("sha256")
    .update(stable({ snapshot, query: input.query, as_of: input.as_of }))
    .digest("hex");

  if (input.position !== undefined && input.position.fingerprint !== fingerprint)
    throw new ApiError(409, "Search/export snapshot changed; restart without a cursor");
  const offset = input.position?.offset ?? 0;
  const next = offset + input.limit;

  return {
    items: items.slice(offset, next),
    total: items.length,
    next_cursor:
      next < items.length
        ? Buffer.from(JSON.stringify({ offset: next, fingerprint, as_of: input.as_of })).toString(
            "base64url",
          )
        : null,
  };
}
