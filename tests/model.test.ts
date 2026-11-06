import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  merge,
  validateMemory,
  archive,
  importedMemories,
  archiveSchema,
  EXPORT_TOMBSTONE_PAGE_SIZE,
  stateSchema,
  type State,
} from "../src/model.ts";

const memory = () =>
  validateMemory({
    identifier: "a",
    media_type: "text/plain",
    created_at: "2026-11-06T12:00:00Z",
    body: "Use TypeScript",
    custom: { owner: "team", nested: [1, 2] },
  });

const state = (origin = "store:a"): State => ({ origin, memories: [], tombstones: [] });

test("unknown fields and origin survive export/import, repeated imports do not duplicate", () => {
  const a = state(),
    b = state("store:b");

  merge(a, [memory()]);
  const exported = archive(a);
  assert.equal(merge(b, importedMemories(exported)).at(0)?.status, "accepted");
  assert.deepEqual(b.memories, a.memories);
  assert.equal(merge(b, importedMemories(exported)).at(0)?.status, "unchanged");
  assert.equal(b.memories.length, 1);
});

test("same identifier from different origins does not collide", () => {
  const s = state();
  merge(s, [
    { ...memory(), x_omp_origin: "a" },
    { ...memory(), x_omp_origin: "b" },
  ]);
  assert.equal(s.memories.length, 2);
});

test("conflicting content does not silently overwrite existing identity", () => {
  const s = state();
  merge(s, [memory()]);
  const receipts = merge(s, [{ ...memory(), body: "Other" }]);
  assert.equal(receipts.at(0)?.status, "rejected");
  assert.equal(s.memories.at(0)?.body, "Use TypeScript");
});

test("tombstone propagates deletion and blocks old snapshot replay", () => {
  const a = state(),
    b = state("b");

  merge(a, [memory()]);
  const stale = archive(a);
  merge(b, importedMemories(stale));
  const t = { origin: a.origin, identifier: "a", deleted_at: "2026-11-06T13:00:00Z" };
  merge(a, [], [t]);
  merge(b, [], archive(a).tombstones);
  assert.equal(merge(b, importedMemories(stale)).at(0)?.reason, "deleted_identity");
  assert.equal(b.memories.length, 0);
});

test("typed body and timestamps are validated", () => {
  for (const patch of [
    { body: 42 },
    { created_at: "bad" },
    { media_type: "" },
    { body: "x".repeat(16385) },
    { valid_from: "2026-11-07T00:00:00Z", valid_until: "2026-11-06T00:00:00Z" },
  ])
    assert.throws(() => validateMemory({ ...memory(), ...patch }));
});

test("mixed-origin exports have unique portable identifiers and roundtrip original identities", () => {
  const source = state();
  merge(source, [
    { ...memory(), x_omp_origin: "first" },
    { ...memory(), x_omp_origin: "second" },
  ]);
  const exported = archiveSchema.parse(archive(source));
  assert.equal(new Set(exported.memories.map((item) => item.identifier)).size, 2);
  const destination = state("destination");
  merge(destination, importedMemories(exported));
  assert.deepEqual(destination.memories, source.memories);
  assert.equal(
    merge(destination, importedMemories(archive(destination))).every(
      (receipt) => receipt.status === "unchanged",
    ),
    true,
  );
  assert.throws(
    () => importedMemories({ ...exported, memories: [memory(), memory()] }),
    /Duplicate/u,
  );
  assert.throws(
    () =>
      importedMemories({ ...exported, manifest: { ...exported.manifest, x_omp_identity_map: [] } }),
    /mapping/u,
  );
});

test("deletion history can grow past 500 without blocking deletion or resurrecting an old snapshot", () => {
  const source = state();
  merge(source, [memory()]);
  const old = archive(source);
  merge(
    source,
    [],
    Array.from({ length: 1500 }, (_, index) => ({
      origin: source.origin,
      identifier: `old-${index}`,
      deleted_at: "2026-11-06T13:00:00Z",
    })),
  );
  merge(
    source,
    [],
    [{ origin: source.origin, identifier: "a", deleted_at: "2026-11-06T13:00:00Z" }],
  );
  assert.equal(stateSchema.parse(source).tombstones.length, 1501);
  assert.equal(merge(source, importedMemories(old)).at(0)?.reason, "deleted_identity");
});

test("export page with worst-case escaped identities fits the REST import limit", () => {
  const escaped = "\u0000".repeat(250);
  const source = state();

  const memories = Array.from({ length: 100 }, (_, index) => ({
    ...memory(),
    identifier: escaped + index,
    x_omp_origin: escaped,
    custom: "x".repeat(1800),
  }));

  merge(source, memories);

  const tombstones = Array.from({ length: EXPORT_TOMBSTONE_PAGE_SIZE }, (_, index) => ({
    origin: escaped,
    identifier: escaped + index,
    deleted_at: "2026-11-06T00:00:00Z",
  }));

  const payload = JSON.stringify({
    ...archive({ ...source, tombstones }),
    next_cursor: "x".repeat(256),
    storage: { commit: "a".repeat(40), provider: "cloudflare-artifacts", repo: "personal" },
  });

  assert.ok(new TextEncoder().encode(payload).length < 1048576);
});
