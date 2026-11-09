import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { OmpError, label, objectSchema, validateMemory, type Memory } from "../core/index.ts";
import { archiveSchema, importedMemories, type Archive } from "./exchange.ts";

/** Repository-local experimental encoding; the draft does not prescribe a file syntax. */
export const markdownFormat = "omp-markdown/0.1";

function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    path
      .split("/")
      .every(
        (part) =>
          part.length <= 120 &&
          /^[a-z0-9][a-z0-9._-]*$/iu.test(part) &&
          !part.endsWith(".") &&
          !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part),
      )
  );
}

const pathSchema = z.string().refine(safePath, "Expected a portable relative path");
const identitySchema = z.object({ origin: label, identifier: label });
const memoryEntrySchema = z.strictObject({
  kind: z.literal("memory"),
  path: pathSchema,
  identity: identitySchema,
  title: z.string(),
  summary: z.string(),
  media_type: z.string(),
});
const directoryEntrySchema = z.strictObject({
  kind: z.literal("directory"),
  path: pathSchema,
  title: z.string(),
});
const indexSchema = z.strictObject({
  format: z.literal(markdownFormat),
  entries: z.array(z.discriminatedUnion("kind", [memoryEntrySchema, directoryEntrySchema])),
});
const sidecarSchema = z.strictObject({
  format: z.literal(markdownFormat),
  identity: identitySchema,
  memory: objectSchema.refine((memory) => !("body" in memory), "Body belongs in the content file"),
});
const descriptorSchema = z.strictObject({
  format: z.literal(markdownFormat),
  losses: z.tuple([]),
  manifest: archiveSchema.shape.manifest,
  tombstones: archiveSchema.shape.tombstones,
  paths: z.array(pathSchema),
});

export type MarkdownEntry = z.infer<typeof indexSchema>["entries"][number];
export interface MarkdownMemory {
  /** Exact serialized memory, including an export alias if the envelope used one. */
  memory: Memory;
  /** Original identity, independent of the projection path and any export alias. */
  identity: { origin: string; identifier: string };
}
export interface MarkdownDirectory {
  readRoot(): Promise<string>;
  list(directory?: string): Promise<readonly MarkdownEntry[]>;
  read(path: string): Promise<MarkdownMemory>;
  /** Explicitly loads all bodies and the exchange manifest/deletion ledger. */
  snapshot(): Promise<Archive>;
}

const parent = (path: string) => path.split("/").slice(0, -1).join("/");
const join = (directory: string, file: string) =>
  directory === "" ? file : directory + "/" + file;
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const reserved = new Set(["memory.md", "memory.index.json", "memory.archive.json"]);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function contentPath(path: string): boolean {
  return (
    safePath(path) &&
    path.endsWith(".md") &&
    !path.split("/").some((part) => reserved.has(part.toLowerCase()))
  );
}

function plain(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").replace(/[\\`*_{}[\]()<>#!|]/gu, "\\$&");
}

/** Pure projection: callers decide how and where to persist the returned files. */
export function exportMarkdown(input: Archive): { files: Map<string, string> } {
  const snapshot = archiveSchema.parse(input);
  const originals = importedMemories(snapshot);
  const files = new Map<string, string>();
  const indexes = new Map<string, MarkdownEntry[]>([["", []]]);
  const allocated = new Set<string>();
  const directories = new Set<string>();
  const paths = new Map<string, string>();
  const records = snapshot.memories.map((memory, index) => {
    const original = originals[index];
    if (original === undefined) throw new OmpError("invalid_input", "Missing original identity");
    return {
      memory,
      identity: {
        origin: original.x_omp_origin ?? snapshot.manifest.origin,
        identifier: original.identifier,
      },
    };
  });

  function available(path: string): boolean {
    const body = path.toLowerCase();
    const sidecar = body + ".json";
    const parts = body.split("/");
    return (
      !allocated.has(body) &&
      !allocated.has(sidecar) &&
      !directories.has(body) &&
      !directories.has(sidecar) &&
      parts.slice(0, -1).every((_, index) => !allocated.has(parts.slice(0, index + 1).join("/")))
    );
  }

  // Assign collisions by identity, so input ordering cannot change a file's location.
  for (const { memory, identity } of records.toSorted((a, b) =>
    compare(JSON.stringify(a.identity), JSON.stringify(b.identity)),
  )) {
    let path = memory.path?.toLowerCase() ?? "";
    if (path !== "" && !path.endsWith(".md")) path += ".md";
    if (!contentPath(path) || !available(path)) {
      const digest = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(identity))));
      let suffix = 0;
      do {
        path = `memories/${digest}${suffix === 0 ? "" : "-" + suffix}.md`;
        suffix++;
      } while (!available(path));
    }
    allocated.add(path.toLowerCase());
    allocated.add(path.toLowerCase() + ".json");
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const directory = parts.slice(0, depth).join("/");
      directories.add(directory.toLowerCase());
      if (!indexes.has(directory)) {
        indexes.set(directory, []);
        indexes
          .get(parent(directory))
          ?.push({ kind: "directory", path: directory, title: parts[depth - 1] ?? directory });
      }
    }
    paths.set(memory.identifier, path);
    indexes.get(parent(path))?.push({
      kind: "memory",
      path,
      identity,
      title: memory.title ?? identity.identifier,
      summary: memory.body.slice(0, 240),
      media_type: memory.media_type,
    });
    const { body, ...metadata } = memory;
    files.set(path, body);
    files.set(path + ".json", json({ format: markdownFormat, identity, memory: metadata }));
  }

  for (const [directory, entries] of indexes) {
    entries.sort((a, b) => compare(a.path, b.path));
    files.set(join(directory, "MEMORY.index.json"), json({ format: markdownFormat, entries }));
    files.set(
      join(directory, "MEMORY.md"),
      `# ${plain(directory || "Memory")}\n\n` +
        entries
          .map((entry) => {
            const relative = entry.path.slice(directory === "" ? 0 : directory.length + 1);
            return entry.kind === "directory"
              ? `- [${plain(entry.title)}/](${relative}/MEMORY.md) — open this directory for summaries.`
              : `- [${plain(entry.title)}](${relative}) — ${plain(entry.summary)}`;
          })
          .join("\n") +
        "\n",
    );
  }
  files.set(
    "MEMORY.archive.json",
    json({
      format: markdownFormat,
      losses: [],
      manifest: snapshot.manifest,
      tombstones: snapshot.tombstones,
      paths: snapshot.memories.map((memory) => paths.get(memory.identifier)),
    }),
  );
  return { files };
}

/** Open an immutable export using any text-file reader: disk, Git, HTTP or object storage. */
export async function openMarkdownDirectory(options: {
  readFile: (path: string) => Promise<string>;
}): Promise<MarkdownDirectory> {
  const indexes = new Map<string, Promise<readonly MarkdownEntry[]>>();

  async function list(directory = ""): Promise<readonly MarkdownEntry[]> {
    if (directory !== "" && !safePath(directory))
      throw new OmpError("invalid_input", "Invalid directory path");
    const cached = indexes.get(directory);
    if (cached !== undefined) return cached;
    const pending = loadIndex(directory);
    indexes.set(directory, pending);
    return pending;
  }

  async function loadIndex(directory: string): Promise<readonly MarkdownEntry[]> {
    if (directory !== "") {
      const siblings = await list(parent(directory));
      if (!siblings.some((entry) => entry.kind === "directory" && entry.path === directory))
        throw new OmpError("invalid_input", "Directory is not listed in its parent");
    }
    const index = indexSchema.parse(
      JSON.parse(await options.readFile(join(directory, "MEMORY.index.json"))),
    );
    if (
      new Set(index.entries.map((entry) => entry.path.toLowerCase())).size !==
        index.entries.length ||
      index.entries.some(
        (entry) =>
          parent(entry.path) !== directory ||
          (entry.kind === "memory" && !contentPath(entry.path)) ||
          entry.path.split("/").some((part) => reserved.has(part.toLowerCase())),
      )
    )
      throw new OmpError("invalid_input", "Index must list distinct immediate children");
    return index.entries;
  }

  async function read(path: string): Promise<MarkdownMemory> {
    if (!contentPath(path)) throw new OmpError("invalid_input", "Invalid memory path");
    const entry = (await list(parent(path))).find((candidate) => candidate.path === path);
    if (entry?.kind !== "memory") throw new OmpError("invalid_input", "Memory is not listed");
    const body = await options.readFile(path);
    const metadata = sidecarSchema.parse(JSON.parse(await options.readFile(path + ".json")));
    const memory = validateMemory({ ...metadata.memory, body });
    if (
      metadata.identity.origin !== entry.identity.origin ||
      metadata.identity.identifier !== entry.identity.identifier ||
      (memory.x_omp_origin !== undefined && memory.x_omp_origin !== metadata.identity.origin)
    )
      throw new OmpError("invalid_input", "Inconsistent memory identity");
    return { memory, identity: metadata.identity };
  }

  await list();
  return {
    readRoot: () => options.readFile("MEMORY.md"),
    list,
    read,
    async snapshot() {
      const descriptor = descriptorSchema.parse(
        JSON.parse(await options.readFile("MEMORY.archive.json")),
      );
      if (new Set(descriptor.paths).size !== descriptor.paths.length)
        throw new OmpError("invalid_input", "Duplicate snapshot paths");
      const memories = await Promise.all(
        descriptor.paths.map(async (path) => (await read(path)).memory),
      );
      const snapshot = archiveSchema.parse({
        manifest: descriptor.manifest,
        tombstones: descriptor.tombstones,
        memories,
      });
      importedMemories(snapshot);
      return snapshot;
    },
  };
}
