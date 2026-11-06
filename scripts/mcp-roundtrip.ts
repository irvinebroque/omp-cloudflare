import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const base = (process.argv[2] ?? "https://ompi-memory.roundtrip.workers.dev").replace(/\/$/, "");
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

async function raw(name: string, args: Record<string, unknown>) {
  return client.callTool({ name, arguments: args });
}

async function call(name: string, args: Record<string, unknown>) {
  const response = await raw(name, args);
  assert.ok(!response.isError, JSON.stringify(response));

  return response.structuredContent as Record<string, any>;
}

async function add(store: string, suffix: string, extra: Record<string, unknown> = {}) {
  const result = await call("add_memory", {
    store,
    identifier: prefix + "-" + suffix,
    body: prefix + " " + suffix,
    title: suffix,
    applies_to: { level: "user" },
    contributor: "agent:omp-test",
    ...extra,
  });
  created.push(result.ref);

  return result;
}

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp")));
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((t) => t.name).sort(), [
    "about_omp",
    "add_memory",
    "delete_memory",
    "get_memory",
    "search_memories",
    "update_memory",
  ]);
  ok("MCP initialize and six-tool discovery");
  const about = await call("about_omp", {});
  assert.equal(about.storage, "Cloudflare Artifacts Git repositories");
  const resource = await client.readResource({ uri: "omp://about" });
  assert.ok(resource.contents.length);
  ok("Capability discovery and resource read");
  const personal = await add("personal", "personal");
  const company = await add("company", "company");
  let search = await call("search_memories", { query: prefix, context });
  assert.equal(search.memories.length, 2);
  assert.deepEqual(
    new Set(search.memories.map((m: any) => m.ref.store)),
    new Set(["personal", "company"]),
  );
  assert.ok(search.memories.every((m: any) => !m.memory && m.snippet));
  const fetched = await call("get_memory", { ...personal.ref, context });
  assert.equal(fetched.memory.body, prefix + " personal");
  assert.equal(fetched.memory.provenance[0].id, "agent:omp-test");
  ok("Writes route to separate stores; search returns summaries and get returns provenance");
  await add("personal", "repo", { applies_to: { level: "repository", repository } });
  const wrong = { repository: "https://github.com/omp-example/other", directory: "." };
  search = await call("search_memories", { query: prefix, context: wrong });
  assert.ok(!search.memories.some((m: any) => m.title === "repo"));
  search = await call("search_memories", { query: prefix, context });
  assert.ok(search.memories.some((m: any) => m.title === "repo"));
  const repoRef = created.at(-1)!;
  assert.equal((await raw("get_memory", { ...repoRef, context: wrong })).isError, true);
  ok("Repository rules do not leak through search or direct reads");
  await add("company", "paths", {
    applies_to: { level: "repository", repository },
    activation: { mode: "paths", globs: ["src/**/*.ts"] },
  });
  search = await call("search_memories", {
    query: prefix,
    context: { repository, directory: ".", paths: ["docs/readme.md"] },
  });
  assert.ok(!search.memories.some((m: any) => m.title === "paths"));
  search = await call("search_memories", { query: prefix, context });
  assert.ok(search.memories.some((m: any) => m.title === "paths"));
  await add("personal", "manual", { activation: { mode: "on_request" } });
  search = await call("search_memories", { query: prefix, context });
  assert.ok(!search.memories.some((m: any) => m.title === "manual"));
  search = await call("search_memories", {
    query: prefix,
    context: { ...context, explicit_request: true },
  });
  assert.ok(search.memories.some((m: any) => m.title === "manual"));
  ok("Path and on-request activation filter correctly");
  const updated = await call("update_memory", {
    ...personal.ref,
    context,
    if_version: personal.version,
    patch: { body: prefix + " revised" },
    contributor: "agent:omp-test",
  });
  assert.notEqual(updated.version, personal.version);
  const stale = await raw("update_memory", {
    ...personal.ref,
    context,
    if_version: personal.version,
    patch: { body: "stale" },
    contributor: "agent:other",
  });
  assert.equal(stale.isError, true);
  assert.equal((stale.structuredContent as any).status, 409);
  const staleDelete = await raw("delete_memory", {
    ...personal.ref,
    context,
    if_version: personal.version,
  });
  assert.equal(staleDelete.isError, true);
  assert.equal(
    (await call("get_memory", { ...personal.ref, context })).memory.body,
    prefix + " revised",
  );
  // Updating a different memory must not invalidate this one's token.
  await call("update_memory", {
    ...company.ref,
    context,
    if_version: company.version,
    patch: { title: "changed elsewhere" },
    contributor: "agent:omp-test",
  });
  await call("update_memory", {
    ...personal.ref,
    context,
    if_version: updated.version,
    patch: { title: "still current" },
    contributor: "agent:omp-test",
  });
  ok("Stale edits/deletes fail; unrelated writes do not invalidate per-memory versions");
  const invalid = await raw("add_memory", {
    store: "company",
    body: "bad",
    applies_to: { level: "repository" },
    contributor: "agent:test",
  });
  assert.equal(invalid.isError, true);
  const unknown = await raw("search_memories", { query: prefix, context, typo: true });
  assert.equal(unknown.isError, true);
  ok("Invalid applicability and unknown tool arguments are rejected");
  // One writer wins when two revisions start from the same version.
  const head = await call("get_memory", { ...company.ref, context });
  const simultaneous = await Promise.all(
    ["first", "second"].map((body) =>
      raw("update_memory", {
        ...company.ref,
        context,
        if_version: head.version,
        patch: { body: prefix + " " + body },
        contributor: "agent:concurrent-test",
      }),
    ),
  );
  assert.equal(simultaneous.filter((r) => !r.isError).length, 1);
  assert.equal(simultaneous.filter((r) => r.isError).length, 1);
  ok("Concurrent edits from the same version produce one winner and one conflict");
} finally {
  for (const ref of created) {
    const memory = await call("get_memory", {
      ...ref,
      context: { ...context, explicit_request: true },
    });
    await call("delete_memory", {
      ...ref,
      context: { ...context, explicit_request: true },
      if_version: memory.version,
    });
  }

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

if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
