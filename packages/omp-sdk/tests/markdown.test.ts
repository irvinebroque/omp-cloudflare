import { expect, it } from "vite-plus/test";
import { memorySchema, type Memory } from "omp-sdk/core";
import { archive, importedMemories } from "omp-sdk/experimental";
import { exportMarkdown, openMarkdownDirectory } from "omp-sdk/experimental/markdown";
import { collisionMemories, referenceMemory } from "omp-sdk/testing";

function reader(files: Map<string, string>, reads: string[] = []) {
  return async (path: string) => {
    reads.push(path);
    const content = files.get(path);
    if (content === undefined) throw new Error("Missing file: " + path);
    return content;
  };
}

function snapshot(memories: Memory[]) {
  return archive({ origin: "source:a", memories, tombstones: [] }, "2026-11-09T00:00:00Z");
}

it("loads only immediate summaries, then the selected body and metadata", async () => {
  const widget = {
    ...referenceMemory,
    path: "projects/widget.md",
    title: "Widget",
    body: "Full widget details",
  };
  const { files } = exportMarkdown(
    snapshot([
      { ...referenceMemory, identifier: "preferences", path: "preferences.md" },
      widget,
      {
        ...referenceMemory,
        identifier: "deeper",
        path: "projects/deep/other.md",
        body: "Deferred secret",
      },
    ]),
  );
  const reads: string[] = [];
  const directory = await openMarkdownDirectory({ readFile: reader(files, reads) });
  expect(reads).toEqual(["MEMORY.index.json"]);
  expect(await directory.readRoot()).toContain("projects/MEMORY.md");
  expect(await directory.readRoot()).not.toContain("Full widget details");
  expect(await directory.list()).toMatchObject([
    { kind: "memory", path: "preferences.md" },
    { kind: "directory", path: "projects" },
  ]);
  expect(await directory.list("projects")).toMatchObject([
    { kind: "directory", path: "projects/deep" },
    { kind: "memory", path: "projects/widget.md", summary: widget.body },
  ]);
  expect(reads).not.toContain("projects/deep/MEMORY.index.json");
  const before = reads.length;
  expect(await directory.read("projects/widget.md")).toEqual({
    memory: widget,
    identity: { origin: "source:a", identifier: widget.identifier },
  });
  expect(reads.slice(before)).toEqual(["projects/widget.md", "projects/widget.md.json"]);
  expect(reads).not.toContain("MEMORY.archive.json");
});

it("round trips metadata, non-Markdown bodies, mixed identities and the deletion ledger without loss", async () => {
  const input = snapshot([
    ...collisionMemories(),
    memorySchema.parse({
      ...referenceMemory,
      identifier: "checksummed",
      path: "data.json",
      media_type: "application/json",
      body: '  {"keep": [true, null]}\n',
      checksum: "sha256:abcd",
      version: { revision: 4 },
      provenance: [{ id: "opaque", kind: "human", extension: { arbitrary: [false, 2] } }],
    }),
  ]);
  input.manifest.custom = { nested: [true, null] };
  input.tombstones.push({
    origin: "source:c",
    identifier: "deleted",
    deleted_at: "2026-11-08T00:00:00Z",
    custom: { retain: true },
  });
  const { files } = exportMarkdown(input);
  const directory = await openMarkdownDirectory({ readFile: reader(files) });
  const restored = await directory.snapshot();
  expect(restored).toEqual(input);
  expect(importedMemories(restored)).toEqual(importedMemories(input));
  expect(JSON.parse(files.get("MEMORY.archive.json") ?? "null")).toMatchObject({ losses: [] });
});

it("shares a deferred directory index across concurrent selected reads", async () => {
  const { files } = exportMarkdown(
    snapshot([
      { ...referenceMemory, identifier: "a", path: "projects/a.md" },
      { ...referenceMemory, identifier: "b", path: "projects/b.md" },
    ]),
  );
  const reads: string[] = [];
  const directory = await openMarkdownDirectory({ readFile: reader(files, reads) });
  const selected = await Promise.all([
    directory.read("projects/a.md"),
    directory.read("projects/b.md"),
  ]);
  expect(selected.map((entry) => entry.identity.identifier)).toEqual(["a", "b"]);
  expect(reads.filter((path) => path === "projects/MEMORY.index.json")).toHaveLength(1);
});

it("allocates portable unique paths without treating identity or original path as a filename", async () => {
  const paths = [
    "../escape",
    "/absolute",
    "MEMORY.md",
    "same.md",
    "SAME.md",
    "foo.md",
    "foo.md/child.md",
    "CON",
    "unicode/é.md",
    "has%2fslash",
    "Back\\slash",
  ];
  const input = snapshot(
    paths.map((path, index) => ({ ...referenceMemory, identifier: "urn:id:" + index, path })),
  );
  const { files } = exportMarkdown(input);
  const bodyPaths = [...files.keys()].filter(
    (path) => path.endsWith(".md") && !path.endsWith("MEMORY.md"),
  );
  expect(bodyPaths).toHaveLength(paths.length);
  expect(new Set([...files.keys()].map((path) => path.toLowerCase())).size).toBe(files.size);
  expect(
    bodyPaths.every((path) => !path.includes("..") && !path.includes(":") && !path.startsWith("/")),
  ).toBe(true);
  expect(files.get("MEMORY.md")).toContain("# Memory");
  const directory = await openMarkdownDirectory({ readFile: reader(files) });
  expect(await directory.snapshot()).toEqual(input);
  const reordered = exportMarkdown({ ...input, memories: input.memories.toReversed() });
  expect([...reordered.files.keys()].toSorted()).toEqual([...files.keys()].toSorted());
});

it("rejects traversal and unlisted reads before calling the file adapter", async () => {
  const { files } = exportMarkdown(snapshot([referenceMemory]));
  const reads: string[] = [];
  const directory = await openMarkdownDirectory({ readFile: reader(files, reads) });
  await expect(directory.read("../outside.md")).rejects.toThrow("Invalid memory path");
  await expect(directory.list("https://example.invalid")).rejects.toThrow("Invalid directory path");
  await expect(directory.read("unlisted.md")).rejects.toThrow("Memory is not listed");
  expect(reads).toEqual(["MEMORY.index.json"]);
  files.set(
    "MEMORY.index.json",
    JSON.stringify({
      format: "omp-markdown/0.1",
      entries: [{ kind: "directory", path: "../outside", title: "Outside" }],
    }),
  );
  await expect(openMarkdownDirectory({ readFile: reader(files, reads) })).rejects.toThrow();
  expect(reads).not.toContain("../outside/MEMORY.index.json");
});

it("rejects inconsistent sidecars and surfaces missing content instead of inventing a body", async () => {
  const memory = { ...referenceMemory, path: "entry.md" };
  const { files } = exportMarkdown(snapshot([memory]));
  const directory = await openMarkdownDirectory({ readFile: reader(files) });
  files.set(
    "entry.md.json",
    JSON.stringify({
      format: "omp-markdown/0.1",
      identity: { origin: "wrong", identifier: memory.identifier },
      memory: { ...memory, body: undefined },
    }),
  );
  await expect(directory.read("entry.md")).rejects.toThrow("Inconsistent memory identity");
  files.delete("entry.md");
  await expect(directory.read("entry.md")).rejects.toThrow("Missing file: entry.md");
});

it("supports an empty directory and rejects malformed or ambiguous indexes", async () => {
  const input = snapshot([]);
  const { files } = exportMarkdown(input);
  const directory = await openMarkdownDirectory({ readFile: reader(files) });
  expect(await directory.list()).toEqual([]);
  expect(await directory.snapshot()).toEqual(input);
  files.set("MEMORY.index.json", "malformed");
  await expect(openMarkdownDirectory({ readFile: reader(files) })).rejects.toThrow();
  files.set(
    "MEMORY.index.json",
    JSON.stringify({
      format: "omp-markdown/0.1",
      entries: [{ kind: "directory", path: "a/b", title: "Too deep" }],
    }),
  );
  await expect(openMarkdownDirectory({ readFile: reader(files) })).rejects.toThrow(
    "immediate children",
  );
  files.set(
    "MEMORY.index.json",
    JSON.stringify({
      format: "omp-markdown/0.1",
      entries: [
        { kind: "directory", path: "a", title: "A" },
        { kind: "directory", path: "A", title: "Also A" },
      ],
    }),
  );
  await expect(openMarkdownDirectory({ readFile: reader(files) })).rejects.toThrow("distinct");
});
