import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { OmpClient } from "../src/client/index.ts";
import { ApiError, archive, type JsonInput } from "../src/protocol/model.ts";
import { readResponse } from "../src/client/index.ts";

const base = process.argv[2] ?? "http://localhost:5173";
const token = process.env.OMP_API_TOKEN ?? "";
const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
const client = new OmpClient(base, "personal", token);
const prefix = "conformance-" + crypto.randomUUID();
const created: { identifier: string; origin?: string | undefined }[] = [];
const mcp = new Client({ name: "omp-conformance", version: "1" });
const absent = (operation: () => Promise<unknown>) =>
  assert.rejects(operation, (error) => error instanceof ApiError && error.status === 404);

async function post(operation: string, data: JsonInput, expected = 200) {
  const response = await fetch(`${base}/stores/personal/fmp/${operation}`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  assert.equal(response.status, expected, `Unexpected status for ${operation}`);
  return response;
}

try {
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers } }),
  );
  await Promise.all(
    [
      { created_at: "2026-02-30T00:00:00Z" },
      { stub: "yes" },
      { path: 42 },
      { scope: "everyone" },
      { provenance: {} },
      { evidence: 17 },
      { links: false },
      { checksum: 42 },
      { updated_at: "yesterday" },
    ].map((patch) =>
      post(
        "upload/inferences",
        { memory: { identifier: prefix + "-invalid", body: "Invalid record", ...patch } },
        400,
      ),
    ),
  );
  const malformed = archive({ origin: prefix, memories: [], tombstones: [] });
  await post(
    "import",
    {
      ...malformed,
      memories: [
        {
          identifier: prefix + "-invalid-import",
          media_type: "text/plain",
          created_at: "2026-11-01T00:00:00Z",
          body: "Invalid import",
          stub: "yes",
        },
      ],
    },
    400,
  );
  await absent(() => client.read(prefix + "-invalid-import"));
  console.log("PASS HTTP upload/import reject malformed standard fields and impossible dates");

  const original = await client.remember({
    identifier: prefix + "-original",
    body: "Original body",
    custom: { retained: [true, null] },
  });
  created.push({ identifier: original.memory.identifier });
  assert.equal(original.memory.provenance?.at(-1)?.kind, "system");
  const revised = await client.update(original.memory.identifier, { body: "Revised body" });
  assert.equal(revised.memory.provenance?.at(-1)?.contribution, "corrected");
  assert.equal(revised.memory.provenance?.length, (original.memory.provenance?.length ?? 0) + 1);
  assert.deepEqual(revised.memory.custom, original.memory.custom);
  await post("update", { identifier: original.memory.identifier, patch: { provenance: [] } }, 400);
  const deletion = await client.delete(original.memory.identifier);
  assert.equal(deletion.tombstone.provenance?.at(-1)?.kind, "system");
  assert.ok(deletion.tombstone.reason !== undefined && deletion.tombstone.reason.length > 0);
  console.log(
    "PASS HTTP mutations record actual system writers and deletion reasons without inventing a human author",
  );

  const expired = await client.remember({
    identifier: prefix + "-expired",
    body: prefix,
    valid_until: "2026-01-01T00:00:00Z",
  });
  const future = await client.remember({
    identifier: prefix + "-future",
    body: prefix,
    valid_from: "2099-01-01T00:00:00Z",
  });
  const old = await client.remember({ identifier: prefix + "-old", body: prefix + " old" });
  const current = await client.remember({
    identifier: prefix + "-new",
    body: prefix + " new",
    links: [{ target: old.memory.identifier, rel: "supersedes" }],
  });
  for (const saved of [expired, future, old, current])
    created.push({ identifier: saved.memory.identifier });
  await Promise.all(
    [expired, future, old].map(async (saved) => {
      await absent(() => client.read(saved.memory.identifier));
      assert.equal(
        (await client.read(saved.memory.identifier, undefined, true)).memory.identifier,
        saved.memory.identifier,
      );
      const result = await mcp.callTool({
        name: "get_memory",
        arguments: {
          store: "personal",
          identifier: saved.memory.identifier,
          origin: saved.memory.x_omp_origin,
          context: {},
        },
      });
      assert.equal(result.isError, true);
      assert.equal(z.object({ status: z.number() }).parse(result.structuredContent).status, 404);
    }),
  );
  assert.deepEqual(
    (await client.search(prefix)).memories.map((memory) => memory.identifier),
    [current.memory.identifier],
  );
  console.log(
    "PASS HTTP and MCP current reads exclude expired, future and superseded records; inactive reads require an explicit flag",
  );

  const missing = prefix + "-missing";
  const dangling = await client.remember({
    identifier: prefix + "-dangling",
    body: `See [[${missing}]].`,
    links: [{ target: missing, rel: "derived_from" }],
    evidence: [{ target: missing }],
  });
  created.push({ identifier: dangling.memory.identifier });
  assert.equal((await client.read(dangling.memory.identifier)).dangling_references.length, 3);
  const fetched = await mcp.callTool({
    name: "get_memory",
    arguments: {
      store: "personal",
      identifier: dangling.memory.identifier,
      origin: dangling.memory.x_omp_origin,
      context: {},
    },
  });
  assert.equal(
    readResponse.omit({ commit: true }).parse(fetched.structuredContent).dangling_references.length,
    3,
  );
  const imported = archive({
    origin: prefix + "-foreign",
    memories: [
      {
        identifier: prefix + "-import-dangling",
        media_type: "text/plain",
        created_at: "2026-11-01T00:00:00Z",
        body: "Imported",
        evidence: [{ target: missing }],
      },
    ],
    tombstones: [],
  });
  assert.equal((await client.import(imported)).receipts[0]?.status, "accepted");
  created.push({ identifier: prefix + "-import-dangling", origin: imported.manifest.origin });
  console.log(
    "PASS missing references survive import and are marked in HTTP, MCP and export metadata",
  );

  await Promise.all(
    [
      { api_key: "synthetic-example-not-real" },
      { body: "password: synthetic-example-not-real" },
      { body: token },
    ].map((extra) =>
      post(
        "upload/inferences",
        { memory: { identifier: prefix + "-secret", body: "Credential fixture", ...extra } },
        400,
      ),
    ),
  );
  const unsafe = {
    ...imported,
    memories: [{ ...imported.memories[0], api_key: "synthetic-example-not-real" }],
  };
  await post("import", unsafe, 400);
  await post(
    "update",
    { identifier: current.memory.identifier, patch: { api_key: "synthetic-example-not-real" } },
    400,
  );
  assert.equal((await client.read(current.memory.identifier)).memory.api_key, undefined);
  console.log(
    "PASS recognizable credentials and the operator access key are rejected by write, update and import",
  );

  const page = await client.export();
  assert.equal(page.manifest.selection, "selection");
  assert.equal(
    z.object({ complete: z.boolean() }).parse(page.manifest.x_omp_pagination).complete,
    false,
  );
  const complete = await client.snapshot();
  assert.equal(complete.manifest.selection, "snapshot");
  assert.equal(complete.manifest.x_omp_pagination, undefined);
  assert.ok(
    z
      .array(z.object({ status: z.literal("dangling") }))
      .parse(complete.manifest.x_omp_dangling_references).length >= 4,
  );
  console.log(
    "PASS export pages are labelled selections and only fully collected exports are labelled snapshots",
  );
} finally {
  await mcp.close();
  await created.reduce(async (previous, item) => {
    await previous;
    await client.delete(item.identifier, item.origin);
  }, Promise.resolve());
}
