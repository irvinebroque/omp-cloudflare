import { describe, expect, it } from "vite-plus/test";
import {
  decodeState,
  archive,
  archiveSchema,
  importedMemories,
  memorySchema,
  merge,
  type Memory,
} from "../src/protocol/model.ts";
import { assertNoCredentials } from "../src/protocol/credentials.ts";
import { currentMemories, danglingReferences } from "../src/protocol/references.ts";

const memory = memorySchema.parse({
  identifier: "urn:memory:project",
  media_type: "text/markdown",
  created_at: "2026-11-01T00:00:00Z",
  body: "Project",
  x_omp_origin: "source:a",
});

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
    const invalid = [
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
    for (const patch of invalid)
      expect(memorySchema.safeParse({ ...memory, ...patch }).success).toBe(false);
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
    const root = memorySchema.parse({
      ...memory,
      identifier: "root",
      body: "See [[urn:memory:project]].",
      links: [{ target: memory.identifier, rel: "derived_from", extension: { keep: true } }],
      evidence: [
        { target: memory.identifier },
        { uri: "https://example.invalid/evidence" },
        "Stated by a person",
      ],
    });
    const originals = [memory, { ...memory, x_omp_origin: "source:b" }, root];
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
