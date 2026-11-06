import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { pageInput, paginate } from "../src/pagination.ts";
import { compareMemories } from "../src/gateway.ts";
import { archive, importedMemories, merge, type State } from "../src/model.ts";

const memory = {
  identifier: "x",
  media_type: "text/plain",
  created_at: "2026-11-06T00:00:00Z",
  body: "Example",
};

test("all 200 federated matches are reachable without duplicates", () => {
  const items = Array.from({ length: 200 }, (_, index) => index);

  function consume(cursor?: string): number[] {
    const chunk = paginate(items, pageInput({ limit: 17, cursor }), {
      commits: ["a", "b"],
      context: {},
    });

    return [...chunk.items, ...(chunk.next_cursor === null ? [] : consume(chunk.next_cursor))];
  }

  assert.deepEqual(consume(), items);
});

test("cursor binds query, context, and store commits and rejects malformed input", () => {
  const snapshot = { commit: "before", context: { repository: "https://example.test/a" } };
  const first = paginate([1, 2], pageInput({ query: "test", limit: 1 }), snapshot);
  assert.notEqual(first.next_cursor, null);
  const next = pageInput({ query: "test", limit: 1, cursor: first.next_cursor ?? undefined });
  assert.deepEqual(paginate([1, 2], next, snapshot).items, [2]);
  assert.throws(
    () => paginate([1, 2], next, { ...snapshot, commit: "after" }),
    /snapshot changed/u,
  );
  assert.throws(() => paginate([1, 2], { ...next, query: "other" }, snapshot), /snapshot changed/u);
  assert.throws(() => paginate([1, 2], next, { ...snapshot, context: {} }), /snapshot changed/u);
  assert.throws(() => pageInput({ cursor: "bad" }), /Invalid cursor/u);
});

test("old always-active memories rank before recent ordinary matches with deterministic ties", () => {
  const ordinary = { ...memory, identifier: "ordinary" };

  const always = {
    ...memory,
    identifier: "preference",
    created_at: "2020-01-01T00:00:00Z",
    activation: { mode: "always" },
  };

  assert.equal([ordinary, always].toSorted(compareMemories).at(0)?.identifier, "preference");
  assert.ok(
    compareMemories({ ...memory, x_omp_origin: "a" }, { ...memory, x_omp_origin: "b" }) < 0,
  );
});

test("bounded export pages preserve a long deletion ledger across import", () => {
  const source: State = {
    origin: "source",
    memories: [memory],
    tombstones: Array.from({ length: 1201 }, (_, index) => ({
      origin: "source",
      identifier: `deleted-${index}`,
      deleted_at: "2026-11-06T00:00:00Z",
    })),
  };

  const target: State = { origin: "target", memories: [], tombstones: [] };

  function copy(cursor?: string) {
    const input = pageInput({ limit: 100, cursor });
    const chunk = paginate(source.tombstones, input, { commit: "fixed" });

    const exported = archive({
      ...source,
      memories: cursor === undefined ? source.memories : [],
      tombstones: chunk.items,
    });

    merge(target, importedMemories(exported), exported.tombstones);

    if (chunk.next_cursor !== null) copy(chunk.next_cursor);
  }

  copy();
  assert.equal(target.memories.length, 1);
  assert.deepEqual(target.tombstones, source.tombstones);
  assert.equal(
    merge(target, [{ ...memory, identifier: "deleted-1200", x_omp_origin: "source" }]).at(0)
      ?.reason,
    "deleted_identity",
  );
});
