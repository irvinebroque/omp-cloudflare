import {
  referenceMemory,
  invalidMemoryPatches,
  collisionMemories,
} from "@omp-cloudflare/sdk/testing";
import { describe, expect, it } from "vite-plus/test";
import {
  objectSchema,
  decodeState,
  archive,
  archiveSchema,
  importedMemories,
  memorySchema,
  merge,
  type Memory,
} from "../src/protocol/model.ts";
import { assertNoCredentials } from "../src/protocol/credentials.ts";
import { currentMemories, danglingReferences } from "@omp-cloudflare/sdk/experimental";

const memory = referenceMemory;

describe("draft metadata contract", () => {
  it("keeps malformed legacy records intact without blocking valid records or exporting invalid memories", () => {
    const legacy = {
      ...memory,
      identifier: "legacy",
      stub: "yes",
      provenance: { old: "shape" },
      custom: { keep: true },
    };
    const state = decodeState({ origin: "source:a", memories: [memory, legacy], tombstones: [] });
    expect(state.memories).toEqual([memory]);
    expect(state.quarantined).toEqual([legacy]);
    expect(decodeState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    const exported = archive(state);
    expect(exported.memories).toEqual([memory]);
    expect(exported.manifest.x_omp_omissions).toEqual({
      quarantined_records: 1,
      reason: "invalid_standard_metadata",
    });
    expect(merge(state, [{ ...memory, identifier: "legacy" }])[0]?.status).toBe("rejected");
    expect(state.quarantined).toEqual([legacy]);
  });
  it("rejects impossible dates and invalid standard fields while retaining nested extensions", () => {
    for (const patch of invalidMemoryPatches) {
      const parsed = objectSchema.parse(patch);
      expect(memorySchema.safeParse({ ...memory, ...parsed }).success).toBe(false);
    }
    const valid = {
      ...memory,
      created_at: "2024-02-29T23:59:59.123+05:30",
      provenance: [{ id: "author", kind: "human", extension: { nested: [null, true] } }],
      future: { metadata: [1, "two"] },
    };
    expect(memorySchema.parse(valid)).toEqual(valid);
  });
});

describe("portable reference semantics", () => {
  it("rewrites opaque identifiers in links, evidence and text and restores them without losing extensions", () => {
    const originals = collisionMemories();
    const snapshot = archive({ origin: "destination", memories: originals, tombstones: [] });
    const exportedRoot = snapshot.memories.find((item) => item.identifier === "root");
    const target = snapshot.memories.find(
      (item) => item.x_omp_origin === "source:a" && item.identifier !== "root",
    );
    expect(exportedRoot?.body).toBe(`See [[${target?.identifier}]].`);
    expect(exportedRoot?.links?.[0]?.target).toBe(target?.identifier);
    expect(exportedRoot?.evidence?.[0]).toEqual({ target: target?.identifier });
    expect(snapshot.manifest.x_omp_dangling_references).toEqual([]);
    expect(importedMemories(archiveSchema.parse(JSON.parse(JSON.stringify(snapshot))))).toEqual(
      originals,
    );
  });

  it("marks missing references separately without mutating source memories and resolves them when targets arrive", () => {
    const root = memorySchema.parse({
      ...memory,
      identifier: "root",
      body: "[[missing]]",
      links: [{ target: "missing", rel: "derived_from" }],
      evidence: [{ target: "missing" }, { uri: "https://example.invalid/external" }],
    });
    const before = structuredClone(root);
    const diagnostic = danglingReferences([root], "destination");
    expect(diagnostic.map((item) => item.field)).toEqual(["links", "evidence", "body"]);
    expect(diagnostic.every((item) => item.status === "dangling")).toBe(true);
    expect(root).toEqual(before);
    expect(danglingReferences([root, { ...memory, identifier: "missing" }], "destination")).toEqual(
      [],
    );
  });

  it("refuses to invalidate a portable checksum while remapping identities", () => {
    expect(() =>
      archive({
        origin: "destination",
        memories: [
          { ...memory, checksum: "sha256:abcd" },
          { ...memory, x_omp_origin: "source:b" },
        ],
        tombstones: [],
      }),
    ).toThrow("checksummed");
  });
});

it("keeps expired and superseded memories out of current reads without hiding another origin's identifier", () => {
  const old = { ...memory, identifier: "old" };
  const replacement: Memory = {
    ...memory,
    identifier: "new",
    valid_until: "2026-11-02T00:00:00Z",
    links: [{ target: "old", rel: "supersedes" }],
  };
  const foreign = { ...old, x_omp_origin: "source:b" };
  const future: Memory = {
    ...memory,
    identifier: "future",
    valid_from: "2027-01-01T00:00:00Z",
    links: [{ target: foreign.identifier, origin: "source:b", rel: "supersedes" }],
  };
  expect(
    currentMemories([old, replacement, foreign, future], Date.parse("2026-11-09T00:00:00Z")),
  ).toEqual([foreign]);
});

it("rejects credential fields, labelled secrets, key material and the operator token without echoing them", () => {
  for (const value of [
    { nested: [{ api_key: "synthetic-secret" }] },
    "password: synthetic-secret",
    "api-key = synthetic-secret",
    "-----BEGIN PRIVATE KEY-----",
    "Bearer syntheticcredential01234567890",
    "https://user:synthetic-secret@example.invalid",
  ])
    expect(() => assertNoCredentials(value)).toThrow("recognizable credentials");
  const operator = "synthetic-operator-key-with-32-characters";
  expect(() => assertNoCredentials("password" + " ".repeat(16384))).not.toThrow();
  expect(() => assertNoCredentials({ body: operator }, operator)).toThrow(
    "recognizable credentials",
  );
  expect(() =>
    assertNoCredentials({ body: "Never put passwords in memory.", custom: { token_count: 42 } }),
  ).not.toThrow();
  expect(() =>
    archive({
      origin: "source",
      memories: [{ ...memory, api_key: "synthetic-secret" }],
      tombstones: [],
    }),
  ).toThrow("recognizable credentials");
});
