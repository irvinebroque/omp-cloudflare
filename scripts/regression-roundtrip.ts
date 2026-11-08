import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { OmpClient, OmpGateway, type Store } from "./lib/memory-client.ts";
import { ApiError, archive, type JsonInput, type Memory } from "../src/protocol/model.ts";
import { readResponse } from "../src/protocol/contracts.ts";

const base = process.argv[2] ?? "http://localhost:5173";
const personal = new OmpClient(base, "personal", process.env.OMP_API_TOKEN ?? "");
const company = new OmpClient(base, "company", process.env.OMP_API_TOKEN ?? "");
const gateway = new OmpGateway(base, process.env.OMP_API_TOKEN ?? "");
const mcp = new Client({ name: "omp-regression", version: "1" });
const prefix = "regression-" + crypto.randomUUID();
const created: { store: Store; identifier: string; origin?: string | undefined }[] = [];
const checks: string[] = [];

const passed = (name: string) => {
  checks.push(name);
  console.error("PASS " + name);
};

const projection = readResponse.omit({ commit: true });

const searchSchema = z.object({
  memories: z.array(z.object({ ref: z.object({ store: z.string(), identifier: z.string() }) })),
  next_cursor: z.string().nullable(),
});

async function tool(name: string, args: Record<string, JsonInput>) {
  const result = await mcp.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));

  return result.structuredContent;
}

try {
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
      requestInit: { headers: { authorization: "Bearer " + (process.env.OMP_API_TOKEN ?? "") } },
    }),
  );
  const id = " " + prefix + " ";

  const stored = await personal.remember({
    identifier: id,
    body: "Pointer only",
    stub: true,
    evidence: { uri: "https://example.invalid/evidence" },
    provenance: { source: "legacy evidence" },
    custom: { preserved: true },
  });

  created.push({ store: "personal", identifier: id });
  const ref = { store: "personal", identifier: id, origin: stored.memory.x_omp_origin };
  const fetched = projection.parse(await tool("get_memory", { ...ref, context: {} }));
  assert.deepEqual(fetched.memory, stored.memory);
  passed("MCP preserves opaque identifiers, stubs, evidence, and extension metadata");

  const rejected = await mcp.callTool({
    name: "update_memory",
    arguments: {
      ...ref,
      context: {},
      if_version: fetched.version,
      patch: { body: "Changed" },
      contributor: "agent:regression",
    },
  });

  assert.equal(rejected.isError, true);
  assert.equal(z.object({ status: z.number() }).parse(rejected.structuredContent).status, 409);
  assert.deepEqual((await personal.read(id)).memory, stored.memory);
  passed("unsupported provenance update returns 409 without altering evidence");

  const ordinary = await company.remember({ identifier: prefix + "-ordinary", body: prefix });
  created.push({ store: "company", identifier: ordinary.memory.identifier });

  const old = await personal.remember({
    identifier: prefix + "-always",
    body: prefix,
    created_at: "2020-01-01T00:00:00Z",
    activation: { mode: "always" },
  });

  created.push({ store: "personal", identifier: old.memory.identifier });

  const first = searchSchema.parse(
    await tool("search_memories", { query: prefix, context: {}, limit: 1 }),
  );

  assert.equal(first.memories.at(0)?.ref.identifier, old.memory.identifier);
  const found = first.memories.map((item) => item.ref.identifier);

  async function collect(cursor: string | null): Promise<void> {
    if (cursor === null) return;

    const next = searchSchema.parse(
      await tool("search_memories", { query: prefix, context: {}, limit: 1, cursor }),
    );

    found.push(...next.memories.map((item) => item.ref.identifier));
    await collect(next.next_cursor);
  }

  await collect(first.next_cursor);
  assert.deepEqual(
    new Set(found),
    new Set([id, ordinary.memory.identifier, old.memory.identifier]),
  );
  assert.equal(found.length, 3);
  passed("MCP paginates both stores and prioritizes an old always-active preference");
  const before = await gateway.search(prefix, 1);
  await personal.update(old.memory.identifier, { title: "Changed snapshot" });
  await assert.rejects(
    gateway.search(prefix, 1, before.next_cursor ?? undefined),
    (error) => error instanceof ApiError && error.status === 409,
  );
  passed("pagination detects concurrent store changes instead of silently skipping results");

  const copies: Memory[] = ["first", "second"].map((origin) => ({
    identifier: prefix + "-shared",
    x_omp_origin: origin,
    media_type: "text/plain",
    created_at: "2026-11-06T00:00:00Z",
    body: "Foreign copy " + origin,
  }));

  const snapshot = archive({ origin: "source", memories: copies, tombstones: [] });

  for (const memory of copies)
    created.push({ store: "personal", identifier: memory.identifier, origin: memory.x_omp_origin });
  await personal.import(snapshot);
  const exported = await personal.export();
  assert.equal(
    new Set(exported.memories.map((memory) => memory.identifier)).size,
    exported.memories.length,
  );

  const mapping = exported.manifest.x_omp_identity_map?.filter(
    (item) => item.identifier === prefix + "-shared",
  );

  assert.equal(mapping?.length, 2);

  const selected = {
    ...exported,
    manifest: { ...exported.manifest, x_omp_identity_map: mapping },
    memories: exported.memories.filter((memory) =>
      mapping?.some((item) => item.exported_identifier === memory.identifier),
    ),
    tombstones: [],
  };

  for (const memory of copies)
    created.push({ store: "company", identifier: memory.identifier, origin: memory.x_omp_origin });
  await company.import(selected);
  await Promise.all(
    copies.map(async (memory) =>
      assert.deepEqual((await company.read(memory.identifier, memory.x_omp_origin)).memory, memory),
    ),
  );
  assert.equal(
    (await company.import(selected)).receipts.every((receipt) => receipt.status === "unchanged"),
    true,
  );
  passed("mixed-origin export/import preserves both identities and repeated copies are idempotent");

  // Content-free deletion markers intentionally remain: pruning them would permit resurrection.
  const ledgerOrigin = prefix + "-deleted";

  const tombstones = Array.from({ length: 51 }, (_, index) => ({
    origin: ledgerOrigin,
    identifier: `deleted-${index}`,
    deleted_at: "2026-11-06T00:00:00Z",
  }));

  await personal.import(archive({ origin: ledgerOrigin, memories: [], tombstones }));

  async function transferLedger(cursor?: string): Promise<{ pages: number; tombstones: number }> {
    const chunk = await personal.export(cursor);
    const selectedTombstones = chunk.tombstones.filter((item) => item.origin === ledgerOrigin);
    await company.import({
      ...chunk,
      manifest: { ...chunk.manifest, x_omp_identity_map: [] },
      memories: [],
      tombstones: selectedTombstones,
    });

    const rest =
      chunk.next_cursor === null
        ? { pages: 0, tombstones: 0 }
        : await transferLedger(chunk.next_cursor);

    return { pages: rest.pages + 1, tombstones: rest.tombstones + selectedTombstones.length };
  }

  const transferred = await transferLedger();
  assert.ok(transferred.pages >= 2);
  assert.equal(transferred.tombstones, 51);

  const replay = await company.import(
    archive({
      origin: ledgerOrigin,
      memories: [
        {
          identifier: "deleted-50",
          media_type: "text/plain",
          created_at: "2026-11-06T00:00:00Z",
          body: "Stale copy",
        },
      ],
      tombstones: [],
    }),
  );

  assert.equal(replay.receipts.at(0)?.reason, "deleted_identity");
  passed("multi-page live exports transfer every tombstone and block stale-copy resurrection");

  const report = { ok: true, base, verifiedAt: new Date().toISOString(), checks };

  if (process.argv[3] !== undefined)
    await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await created.reduce(async (previous, ref) => {
    await previous;

    try {
      await new OmpClient(base, ref.store, process.env.OMP_API_TOKEN ?? "").delete(
        ref.identifier,
        ref.origin,
      );
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }, Promise.resolve());
  await mcp.close();
}
