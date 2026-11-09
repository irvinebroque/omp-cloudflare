import { objectSchema } from "./json.ts";
import type { Json, Memory } from "./model.ts";

// Local convention for the draft's still-open reference shapes. Opaque JSON is preserved.
export interface MemoryReference {
  field: "body" | "links" | "evidence";
  target: string;
  origin?: string | undefined;
}

const wiki = /\[\[([^\]\n]+)\]\]/gu;

function reference(value: Json, field: "links" | "evidence"): MemoryReference | undefined {
  const parsed = objectSchema.safeParse(value);
  if (!parsed.success || typeof parsed.data.target !== "string") return undefined;
  const origin = parsed.data.origin;
  // Unknown origin qualifiers must not silently become local references.
  if (origin !== undefined && typeof origin !== "string") return undefined;
  return { field, target: parsed.data.target, origin };
}

export function references(memory: Memory): MemoryReference[] {
  const found: MemoryReference[] = [];
  for (const field of ["links", "evidence"] as const)
    for (const item of memory[field] ?? []) {
      const ref = reference(item, field);
      if (ref !== undefined) found.push(ref);
    }
  if (
    ["text/plain", "text/markdown"].includes(memory.media_type.split(";")[0]?.toLowerCase() ?? "")
  )
    for (const match of memory.body.matchAll(wiki))
      if (match[1] !== undefined) found.push({ field: "body", target: match[1] });
  return found;
}

export function rewriteReferences(
  memory: Memory,
  resolve: (target: string, origin?: string) => string,
): Memory {
  const rewrite = (
    value: string | Record<string, Json>,
    field: "links" | "evidence",
  ): string | Record<string, Json> => {
    const ref = reference(value, field);
    const parsed = objectSchema.safeParse(value);
    return ref === undefined || !parsed.success
      ? value
      : { ...parsed.data, target: resolve(ref.target, ref.origin) };
  };
  return {
    ...memory,
    ...(memory.links === undefined
      ? {}
      : { links: memory.links.map((item) => objectSchema.parse(rewrite(item, "links"))) }),
    ...(memory.evidence === undefined
      ? {}
      : { evidence: memory.evidence.map((item) => rewrite(item, "evidence")) }),
    body: ["text/plain", "text/markdown"].includes(
      memory.media_type.split(";")[0]?.toLowerCase() ?? "",
    )
      ? memory.body.replace(wiki, (_original: string, target: string) => `[[${resolve(target)}]]`)
      : memory.body,
  };
}

export function danglingReferences(memories: readonly Memory[], fallback: string) {
  const present = new Set(
    memories.map((memory) => JSON.stringify([memory.x_omp_origin ?? fallback, memory.identifier])),
  );
  return memories.flatMap((memory) =>
    references(memory).flatMap((ref) =>
      present.has(JSON.stringify([ref.origin ?? memory.x_omp_origin ?? fallback, ref.target]))
        ? []
        : [
            {
              identifier: memory.identifier,
              origin: memory.x_omp_origin ?? fallback,
              field: ref.field,
              target: ref.target,
              ...(ref.origin === undefined ? {} : { target_origin: ref.origin }),
              status: "dangling" as const,
            },
          ],
    ),
  );
}

/** Supersession is local to an origin unless the edge explicitly supplies its target origin. */
export function currentMemories(memories: readonly Memory[], now = Date.now()): Memory[] {
  const valid = memories.filter(
    (memory) =>
      (memory.valid_from === undefined || Date.parse(memory.valid_from) <= now) &&
      (memory.valid_until === undefined || Date.parse(memory.valid_until) > now),
  );
  const superseded = new Set(
    memories
      .filter((memory) => memory.valid_from === undefined || Date.parse(memory.valid_from) <= now)
      .flatMap((memory) =>
        (memory.links ?? []).flatMap((edge) =>
          edge.rel === "supersedes" &&
          typeof edge.target === "string" &&
          (edge.origin === undefined || typeof edge.origin === "string")
            ? [JSON.stringify([edge.origin ?? memory.x_omp_origin ?? "", edge.target])]
            : [],
        ),
      ),
  );
  return valid.filter(
    (memory) => !superseded.has(JSON.stringify([memory.x_omp_origin ?? "", memory.identifier])),
  );
}
