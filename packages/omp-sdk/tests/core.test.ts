import { describe, expect, it } from "vite-plus/test";
import { appendContribution, memorySchema, objectSchema, stable } from "omp-sdk/core";
import { referenceMemory, invalidMemoryPatches } from "omp-sdk/testing";

describe("public portable memory contract", () => {
  it("rejects malformed draft metadata and preserves extensions", () => {
    for (const patch of invalidMemoryPatches)
      expect(
        memorySchema.safeParse({ ...referenceMemory, ...objectSchema.parse(patch) }).success,
      ).toBe(false);
    expect(memorySchema.parse(referenceMemory)).toEqual(referenceMemory);
    expect(
      memorySchema.parse({ ...referenceMemory, created_at: "2024-02-29T23:59:59+05:30" })
        .created_at,
    ).toBe("2024-02-29T23:59:59+05:30");
  });
  it("accepts portable memories beyond this example's deployment quotas", () => {
    const large = {
      ...referenceMemory,
      body: "🧠".repeat(5000),
      tags: Array.from({ length: 40 }, (_, i) => String(i)),
    };
    expect(memorySchema.parse(large)).toEqual(large);
  });
  it("appends explicit contributors without changing existing attribution or input", () => {
    const original = structuredClone(referenceMemory);
    const first = { id: "opaque-author", kind: "human" as const, extension: { nested: [true] } };
    const second = {
      id: "opaque-process",
      kind: "system" as const,
      contribution: "recorded",
      at: "2026-11-09T00:00:00Z",
    };
    const updated = appendContribution(appendContribution(original, first), second);
    expect(updated.provenance).toEqual([first, second]);
    expect(original).toEqual(referenceMemory);
  });
  it("serializes JSON independently of insertion order without losing extensions", () => {
    expect(stable({ z: 1, a: { x: true, b: null } })).toBe(
      stable({ a: { b: null, x: true }, z: 1 }),
    );
  });
});
