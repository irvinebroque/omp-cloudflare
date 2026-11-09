import { expect, it } from "vite-plus/test";
import {
  archive,
  archiveSchema,
  importedMemories,
  danglingReferences,
  currentMemories,
} from "omp-sdk/experimental";
import { collisionMemories, referenceMemory } from "omp-sdk/testing";

it("§8.6 rejects recognizable credential data at the portable export boundary", () => {
  const secret = "synthetic-secret-for-regression";
  for (const memory of [
    { ...referenceMemory, api_key: secret },
    { ...referenceMemory, body: "password: " + secret },
  ]) {
    try {
      archive({ origin: "source", memories: [memory], tombstones: [] });
      throw new Error("Expected credential rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_input" });
      expect(error instanceof Error && error.message.includes(secret)).toBe(false);
    }
  }
  expect(() =>
    archive({
      origin: "source",
      memories: [referenceMemory],
      tombstones: [
        {
          origin: "source",
          identifier: "deleted",
          deleted_at: "2026-11-09T00:00:00Z",
          password: secret,
        },
      ],
    }),
  ).toThrow("recognizable credentials");
});

it("round trips mixed origins through the public experimental envelope without losing references", () => {
  const memories = collisionMemories();
  const snapshot = archive(
    { origin: "destination", memories, tombstones: [] },
    "2026-11-09T00:00:00Z",
  );
  expect(snapshot.manifest.exported_at).toBe("2026-11-09T00:00:00Z");
  expect(new Set(snapshot.memories.map((item) => item.identifier)).size).toBe(memories.length);
  expect(danglingReferences(snapshot.memories, "destination")).toEqual([]);
  expect(importedMemories(archiveSchema.parse(JSON.parse(JSON.stringify(snapshot))))).toEqual(
    memories,
  );
});

it("preserves unknown manifest extensions and rejects corrupt identity maps", () => {
  const snapshot = archive({ origin: "source", memories: [referenceMemory], tombstones: [] });
  snapshot.manifest.custom = { nested: [true, null] };
  snapshot.manifest.x_omp_reference_convention = "omp-cloudflare-references/0.1";
  expect(archiveSchema.parse(snapshot).manifest.custom).toEqual({ nested: [true, null] });
  expect(importedMemories(archiveSchema.parse(snapshot))).toEqual([referenceMemory]);
  snapshot.manifest.x_omp_identity_map = [];
  expect(() => importedMemories(snapshot)).toThrow("Invalid export identity mapping");
});

it("keeps dangling targets intact and checksummed identities immutable", () => {
  const root = { ...referenceMemory, body: "[[absent]]" };
  expect(danglingReferences([root], "source")[0]?.target).toBe("absent");
  expect(root.body).toBe("[[absent]]");
  expect(() =>
    archive({
      origin: "destination",
      memories: collisionMemories().map((item) => Object.assign(item, { checksum: "sha256:abcd" })),
      tombstones: [],
    }),
  ).toThrow("checksummed");
});

it("does not revive a superseded memory when its replacement expires", () => {
  const old = { ...referenceMemory, identifier: "old" };
  const replacement = {
    ...referenceMemory,
    identifier: "new",
    valid_until: "2026-11-02T00:00:00Z",
    links: [{ rel: "supersedes", target: "old" }],
  };
  expect(currentMemories([old, replacement], Date.parse("2026-11-09T00:00:00Z"))).toEqual([]);
});
