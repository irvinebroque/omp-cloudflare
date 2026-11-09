import { memorySchema, type Memory, type JsonInput } from "../core/index.ts";

export const referenceMemory: Memory = memorySchema.parse({
  identifier: "urn:memory:project",
  media_type: "text/markdown",
  created_at: "2026-11-01T00:00:00Z",
  body: "Project",
  x_omp_origin: "source:a",
  custom: { nested: [42, true, null] },
});

export const invalidMemoryPatches: readonly JsonInput[] = [
  { created_at: "2026-02-30T00:00:00Z" },
  { created_at: "2026-11-31T00:00:00Z" },
  { stub: "yes" },
  { path: 42 },
  { scope: "everyone" },
  { provenance: {} },
  { provenance: [{ id: "unknown", kind: "robot" }] },
  { provenance: [{ kind: "human" }] },
  { provenance: [{ id: "author", kind: "human", at: "yesterday" }] },
  { evidence: 17 },
  { links: false },
  { checksum: 42 },
  { updated_at: "yesterday" },
];

/** Fresh collision fixture covering opaque identities, nested extensions and recognized references. */
export function collisionMemories(): Memory[] {
  return structuredClone([
    referenceMemory,
    { ...referenceMemory, x_omp_origin: "source:b" },
    {
      ...referenceMemory,
      identifier: "root",
      body: "See [[urn:memory:project]].",
      links: [
        { target: referenceMemory.identifier, rel: "derived_from", extension: { keep: true } },
      ],
      evidence: [
        { target: referenceMemory.identifier },
        { uri: "https://example.invalid/evidence" },
        "Stated by a person",
      ],
    },
  ]);
}
