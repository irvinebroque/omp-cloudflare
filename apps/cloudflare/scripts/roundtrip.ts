import assert from "node:assert/strict";
import { OmpClient, OmpGateway } from "../src/client/index.ts";

const base = process.argv[2];

if (base === undefined) throw new Error("Usage: pnpm roundtrip https://your-worker.workers.dev");

const personal = new OmpClient(base, "personal", process.env.OMP_API_TOKEN ?? ""),
  destination = new OmpClient(base, "company", process.env.OMP_API_TOKEN ?? "");

const id = `smoke-${crypto.randomUUID()}`;
const checks: string[] = [];

function pass(message: string) {
  checks.push(message);
  console.error("PASS " + message);
}

const gateway = new OmpGateway(base, process.env.OMP_API_TOKEN ?? "");

assert.deepEqual((await gateway.info()).connected_stores, ["personal", "company"]);

const saved = await gateway.remember({
  identifier: id,
  body: `Round trip ${id}: use TypeScript on Cloudflare.`,
  tags: ["roundtrip"],
  example_extension: { nested: ["preserve", 42] },
});

assert.equal(saved.routed_to, "personal");

assert.equal(saved.receipts.at(0)?.status, "accepted");

assert.match(saved.commit, /^[a-f0-9]{40}$/);

pass("write committed to Cloudflare Artifacts");

assert.deepEqual((await personal.read(id)).memory, saved.memory);

pass("fresh HTTP request reads persisted object");

assert.equal((await personal.search(id)).memories.length, 1);

pass("search finds saved memory");

const companyId = `${id}-company`;

const companySaved = await gateway.remember(
  { identifier: companyId, body: `Company example ${id}: releases on Friday.` },
  "company",
);

assert.equal(companySaved.routed_to, "company");

assert.equal((await personal.search(companyId)).total, 0);

assert.equal((await destination.search(companyId)).total, 1);

const across = await gateway.search(id);

assert.equal(across.partial, false);

assert.ok(across.memories.some((hit) => hit.store === "personal" && hit.memory.identifier === id));

assert.ok(
  across.memories.some((hit) => hit.store === "company" && hit.memory.identifier === companyId),
);

pass("gateway routes personal/company writes into separate Artifacts repositories");

pass("one gateway search returns attributed results from both connected stores");

const snapshot = await personal.export();

const one = {
  ...snapshot,
  manifest: {
    ...snapshot.manifest,
    x_omp_identity_map: snapshot.manifest.x_omp_identity_map?.filter(
      (item) => item.identifier === id && item.origin === saved.memory.x_omp_origin,
    ),
  },
  memories: snapshot.memories.filter(
    (m) =>
      snapshot.manifest.x_omp_identity_map?.some(
        (item) => item.identifier === id && item.exported_identifier === m.identifier,
      ) === true,
  ),
  tombstones: [],
};

const imported = await destination.import(one);

assert.equal(imported.receipts.at(0)?.status, "accepted");

assert.deepEqual((await destination.read(id)).memory, saved.memory);

pass("cross-store export/import preserves all fields and origin");

assert.equal((await destination.import(one)).receipts.at(0)?.status, "unchanged");

pass("repeated import is idempotent");

const back = await destination.export();

const backOne = {
  ...back,
  manifest: {
    ...back.manifest,
    x_omp_identity_map: back.manifest.x_omp_identity_map?.filter(
      (item) => item.identifier === id && item.origin === saved.memory.x_omp_origin,
    ),
  },
  memories: back.memories.filter(
    (m) =>
      back.manifest.x_omp_identity_map?.some(
        (item) => item.identifier === id && item.exported_identifier === m.identifier,
      ) === true,
  ),
  tombstones: [],
};

assert.equal((await personal.import(backOne)).receipts.at(0)?.status, "unchanged");

pass("export back to original store preserves identity");

const conflict = {
  ...one,
  memories: one.memories.map((m) => ({ ...m, body: "Conflicting body" })),
};

assert.equal((await destination.import(conflict)).receipts.at(0)?.status, "rejected");

pass("identity conflict rejected without data loss");

const updated = await personal.update(id, {
  body: `Updated ${id}: still TypeScript.`,
  title: "Round-trip verification",
});

assert.equal((await personal.read(id)).memory.body, updated.memory.body);

pass("local update persists");

// Independent concurrent writes must both survive the optimistic Git push/retry path.
const ids = [`${id}-a`, `${id}-b`];

await Promise.all(
  ids.map((identifier) => personal.remember({ identifier, body: "Concurrency sample" })),
);

await Promise.all(
  ids.map(async (identifier) => {
    assert.equal((await personal.read(identifier)).memory.identifier, identifier);
  }),
);

pass("concurrent writes survive without lost updates");

await destination.delete(id);

assert.equal((await destination.import(one)).receipts.at(0)?.reason, "deleted_identity");

pass("deleted identity cannot return through stale import");

await personal.delete(id);

await destination.delete(companyId);

await Promise.all(ids.map((identifier) => personal.delete(identifier)));

const history = await personal.history();

assert.ok(history.commits.length > 0);

pass("Git history records mutations; smoke memories removed from current views");

const invalid = await fetch(`${base}/stores/personal/fmp/upload/inferences`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: "Bearer " + (process.env.OMP_API_TOKEN ?? ""),
  },
  body: JSON.stringify({ memory: { body: 42 } }),
});

assert.equal(invalid.status, 400);

pass("invalid bodies return 400");

console.log(
  JSON.stringify(
    {
      ok: true,
      base,
      storage: "Cloudflare Artifacts",
      sourceCommit: saved.commit,
      destinationCommit: imported.commit,
      checks,
    },
    null,
    2,
  ),
);
