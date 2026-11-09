import { z } from "zod";
import { type JsonInput, jsonValue } from "../src/protocol/model.ts";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const referenceSchema = z.object({
  store: z.enum(["personal", "company"]),
  identifier: z.string(),
  origin: z.string(),
});

const projectSchema = z.object({
  ref: referenceSchema,
  version: z.string(),
  memory: z.object({ body: z.string(), provenance: z.array(z.object({ id: z.string() })) }),
});

const searchSchema = z.object({
  memories: z.array(
    z.object({
      ref: referenceSchema,
      title: z.string().optional(),
      snippet: z.string(),
      memory: z.never().optional(),
    }),
  ),
  total: z.number(),
});

const aboutSchema = z.object({ storage: z.string() });
const statusSchema = z.object({ status: z.number() });

const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const client = new Client({ name: "omp-roundtrip", version: "0.1.0" });
const prefix = "mcp-check-" + crypto.randomUUID();
const repository = "https://github.com/omp-example/" + prefix;
const context = { repository, directory: ".", paths: ["src/example.ts"] };
const created: { store: string; identifier: string; origin: string }[] = [];
const checks: string[] = [];

const ok = (name: string) => {
  checks.push(name);
  console.error("PASS " + name);
};

async function raw(name: string, args: Record<string, JsonInput>) {
  return client.callTool({ name, arguments: args });
}

async function call<S extends z.ZodType>(
  schema: S,
  name: string,
  args: Record<string, JsonInput>,
): Promise<z.output<S>> {
  const response = await raw(name, args);
  assert.ok(response.isError !== true, JSON.stringify(response));

  return schema.parse(response.structuredContent);
}

async function add(store: string, suffix: string, extra: Record<string, JsonInput> = {}) {
  const result = await call(projectSchema, "add_memory", {
    store,
    identifier: prefix + "-" + suffix,
    body: prefix + " " + suffix,
    title: suffix,
    applies_to: { level: "user" },
    contributor: { id: "agent:omp-test", kind: "agent" },
    ...extra,
  });

  created.push(result.ref);

  return result;
}

try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
      requestInit: { headers: { authorization: "Bearer " + (process.env.OMP_API_TOKEN ?? "") } },
    }),
  );
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((t) => t.name).toSorted(), [
    "about_omp",
    "add_memory",
    "delete_memory",
    "get_memory",
    "search_memories",
    "update_memory",
  ]);
  ok("MCP initialize and six-tool discovery");
  const about = await call(aboutSchema, "about_omp", {});
  assert.equal(about.storage, "Cloudflare Artifacts Git repositories");
  const resource = await client.readResource({ uri: "omp://about" });
  assert.ok(resource.contents.length);
  ok("Capability discovery and resource read");
  const personal = await add("personal", "personal");
  const company = await add("company", "company");
  let search = await call(searchSchema, "search_memories", { query: prefix, context });
  assert.equal(search.memories.length, 2);
  assert.deepEqual(
    new Set(search.memories.map((m) => m.ref.store)),
    new Set(["personal", "company"]),
  );
  assert.ok(search.memories.every((m) => m.memory === undefined && m.snippet.length > 0));
  const fetched = await call(projectSchema, "get_memory", { ...personal.ref, context });
  assert.equal(fetched.memory.body, prefix + " personal");
  assert.equal(fetched.memory.provenance.at(0)?.id, "agent:omp-test");
  ok("Writes route to separate stores; search returns summaries and get returns provenance");
  await add("personal", "repo", { applies_to: { level: "repository", repository } });
  const wrong = { repository: "https://github.com/omp-example/other", directory: "." };
  search = await call(searchSchema, "search_memories", { query: prefix, context: wrong });
  assert.ok(!search.memories.some((m) => m.title === "repo"));
  search = await call(searchSchema, "search_memories", { query: prefix, context });
  assert.ok(search.memories.some((m) => m.title === "repo"));
  const repoRef = created.at(-1);
  assert.ok(repoRef);
  assert.equal((await raw("get_memory", { ...repoRef, context: wrong })).isError, true);
  ok("Repository rules do not leak through search or direct reads");
  await add("company", "paths", {
    applies_to: { level: "repository", repository },
    activation: { mode: "paths", globs: ["src/**/*.ts"] },
  });
  search = await call(searchSchema, "search_memories", {
    query: prefix,
    context: { repository, directory: ".", paths: ["docs/readme.md"] },
  });
  assert.ok(!search.memories.some((m) => m.title === "paths"));
  search = await call(searchSchema, "search_memories", { query: prefix, context });
  assert.ok(search.memories.some((m) => m.title === "paths"));
  await add("personal", "manual", { activation: { mode: "on_request" } });
  search = await call(searchSchema, "search_memories", { query: prefix, context });
  assert.ok(!search.memories.some((m) => m.title === "manual"));
  search = await call(searchSchema, "search_memories", {
    query: prefix,
    context: { ...context, explicit_request: true },
  });
  assert.ok(search.memories.some((m) => m.title === "manual"));
  ok("Path and on-request activation filter correctly");

  const updated = await call(projectSchema, "update_memory", {
    ...personal.ref,
    context,
    if_version: personal.version,
    patch: { body: prefix + " revised" },
    contributor: { id: "agent:omp-test", kind: "agent" },
  });

  assert.notEqual(updated.version, personal.version);

  const stale = await raw("update_memory", {
    ...personal.ref,
    context,
    if_version: personal.version,
    patch: { body: "stale" },
    contributor: { id: "agent:other", kind: "agent" },
  });

  assert.equal(stale.isError, true);
  assert.equal(statusSchema.parse(stale.structuredContent).status, 409);

  const staleDelete = await raw("delete_memory", {
    ...personal.ref,
    context,
    if_version: personal.version,
  });

  assert.equal(staleDelete.isError, true);
  assert.equal(
    (await call(projectSchema, "get_memory", { ...personal.ref, context })).memory.body,
    prefix + " revised",
  );
  // Updating a different memory must not invalidate this one's token.
  await call(projectSchema, "update_memory", {
    ...company.ref,
    context,
    if_version: company.version,
    patch: { title: "changed elsewhere" },
    contributor: { id: "agent:omp-test", kind: "agent" },
  });
  await call(projectSchema, "update_memory", {
    ...personal.ref,
    context,
    if_version: updated.version,
    patch: { title: "still current" },
    contributor: { id: "agent:omp-test", kind: "agent" },
  });
  ok("Stale edits/deletes fail; unrelated writes do not invalidate per-memory versions");

  const invalid = await raw("add_memory", {
    store: "company",
    body: "bad",
    applies_to: { level: "repository" },
    contributor: { id: "agent:test", kind: "agent" },
  });

  assert.equal(invalid.isError, true);
  const unknown = await raw("search_memories", { query: prefix, context, typo: true });
  assert.equal(unknown.isError, true);
  ok("Invalid applicability and unknown tool arguments are rejected");
  // One writer wins when two revisions start from the same version.
  const head = await call(projectSchema, "get_memory", { ...company.ref, context });

  const simultaneous = await Promise.all(
    ["first", "second"].map((body) =>
      raw("update_memory", {
        ...company.ref,
        context,
        if_version: head.version,
        patch: { body: prefix + " " + body },
        contributor: { id: "agent:concurrent-test", kind: "agent" },
      }),
    ),
  );

  assert.equal(simultaneous.filter((r) => r.isError !== true).length, 1);
  assert.equal(simultaneous.filter((r) => r.isError === true).length, 1);
  ok("Concurrent edits from the same version produce one winner and one conflict");
} finally {
  await created.reduce(async (previous, ref) => {
    await previous;

    const memory = await call(projectSchema, "get_memory", {
      ...ref,
      context: { ...context, explicit_request: true },
    });

    await call(jsonValue, "delete_memory", {
      ...ref,
      context: { ...context, explicit_request: true },
      if_version: memory.version,
    });
  }, Promise.resolve());

  await client.close();
}

const report = {
  url: base + "/mcp",
  checked_at: new Date().toISOString(),
  passed: checks.length,
  checks,
  cleanup: "Removed test memories from current views; history and tombstones retained.",
};

console.log(JSON.stringify(report, null, 2));

if (process.argv[3] !== undefined)
  await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
