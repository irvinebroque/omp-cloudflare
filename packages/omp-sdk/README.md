# omp-sdk

Provider-neutral TypeScript building blocks for the [OMP v0.5 editors’ draft](https://github.com/The-AI-Disclosures-Project/Open-Memory-Protocol/blob/main/working-group/exchange-and-runtime/2026-11-06-working-spec-v0.5.md). This community package is developed here as a candidate for future upstream work. It is not an official OMP SDK, an adopted standard, or a claim of complete conformance. The package is not published by the workspace build.

The SDK handles memory data: validation, provenance, references, exchange and Markdown projection/loading. It has no Cloudflare or Node imports, HTTP routes, authentication, storage implementation, deployment quotas or dependency on the example app. The Cloudflare app depends on the SDK through its public exports; the SDK works independently of the app.

## Entry points

| Import                          | Contents                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `omp-sdk/core`                  | Memory, contributor and JSON types; lossless schema validation; identity keys; deterministic JSON comparison; explicit provenance appending         |
| `omp-sdk/experimental`          | Copy envelopes, reversible identity mapping, the experimental `omp-references/0.1` convention, dangling-reference diagnostics and lifecycle helpers |
| `omp-sdk/experimental/markdown` | Pure Markdown directory export and progressive loading through a caller-supplied text-file reader                                                   |
| `omp-sdk/testing`               | Valid/invalid metadata fixtures and a fresh mixed-origin collision fixture                                                                          |

The package exports ESM JavaScript and TypeScript declarations, targeting ES2024 with `TextEncoder` and `structuredClone`. It uses portable hashing. The former `@omp-cloudflare/sdk` name and `bindings/omp-cloudflare` entry point have been removed; the example’s HTTP client/contracts now live in [`apps/cloudflare/src/client`](../../apps/cloudflare/src/client).

## Validate and attribute a memory

```ts
import { appendContribution, memorySchema } from "omp-sdk/core";

const memory = memorySchema.parse({
  identifier: "preferences",
  media_type: "text/markdown",
  created_at: "2026-11-09T00:00:00Z",
  path: "projects/widget.md",
  body: "Prefer TypeScript examples.",
  custom: { nested: [true, null] },
});
const attributed = appendContribution(memory, {
  id: "agent:example",
  kind: "agent",
  contribution: "authored",
  at: "2026-11-09T00:00:00Z",
});
```

Unknown JSON metadata survives parsing, including contributor extensions. Attribution is explicit: `appendContribution` neither infers kind from an ID nor invents an author. Applications enforce their own resource/request limits and supply checks for credentials known to them. Portable export helpers reject recognizable credential data under draft §8.6; `assertNoCredentials(value, knownSecrets?)` can additionally check caller-supplied secrets. This does not classify arbitrary unlabelled text as secret or safe. `OmpError` carries semantic `invalid_input`/`conflict` codes; applications choose their own transport status mapping.

`key(memory, fallbackOrigin)` constructs an identity key; `stable(value)` compares deterministic JSON. Neither is a portable checksum or revision-comparison standard. `x_omp_origin` is an experimental convention for retaining source origin.

## Exchange without a server

```ts
import { archive, archiveSchema, importedMemories } from "omp-sdk/experimental";

const snapshot = archive({
  origin: "example:source",
  memories: [attributed],
  tombstones: [],
});
const parsed = archiveSchema.parse(JSON.parse(JSON.stringify(snapshot)));
const restored = importedMemories(parsed);
```

The experimental envelope supports `minimal`/`copy` snapshots and selections. Colliding identifiers are aliased consistently across recognized links, evidence targets and exact `[[identifier]]` references in plain text or Markdown. The identity map restores original identities on import. Unknown reference shapes stay opaque. A checksummed memory needing rewriting causes an error rather than acquiring a stale checksum.

`danglingReferences` reports missing recognized targets separately from memory objects. `currentMemories` excludes expired, future and superseded memories using this convention. Imported provenance and evidence are claims by their source origin, not verified facts. Missing provenance means unknown authorship. The SDK does not merge conflicting revisions or implement ACLs, runtime activation policy, ranking or storage.

## Export and load Markdown progressively

```ts
import { exportMarkdown, openMarkdownDirectory } from "omp-sdk/experimental/markdown";

const { files } = exportMarkdown(snapshot); // Map<relativePath, fileContents>
// Persist these files using your filesystem, Git or object-storage adapter.

const directory = await openMarkdownDirectory({
  readFile: async (path) => {
    const content = files.get(path);
    if (content === undefined) throw new Error("Missing file: " + path);
    return content;
  },
});
const root = await directory.readRoot();
const entries = await directory.list("projects");
const { memory: fullMemory, identity } = await directory.read("projects/widget.md");
const completeSnapshot = await directory.snapshot();
```

Opening reads only the root index. `readRoot()` reads the root `MEMORY.md`. Each `list(directory?)` loads that directory’s immediate summaries and directory links, leaving deeper indexes and bodies deferred. `read(path)` loads one selected body and its metadata sidecar, plus any unread ancestor indexes. Its `identity` retains the original origin/identifier; `memory` retains the envelope’s serialized identifier, including an alias if one was necessary. Use paths returned by `list`, since paths are independent of identity.

`snapshot()` explicitly reads the manifest/deletion ledger and every listed memory in its original order. The reconstructed envelope preserves bodies, unknown metadata, provenance, identity mapping and tombstones, and can be passed to an implementation’s importer. It is a copy projection, not bidirectional editing or synchronization. Keep the export immutable while reading it; reopen after replacing it.

For a local checkout, the adapter is ordinary Node code in your application:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openMarkdownDirectory } from "omp-sdk/experimental/markdown";

const directory = await openMarkdownDirectory({
  readFile: (path) => readFile(join(checkoutDirectory, path), "utf8"),
});
```

### Experimental directory encoding

```text
MEMORY.md                    Human-readable root summary and child links
MEMORY.index.json            Machine-readable immediate children
MEMORY.archive.json          Original manifest, tombstones, ordering and losses: []
projects/MEMORY.md           Only this directory’s immediate summaries
projects/MEMORY.index.json   Machine-readable children of projects/
projects/widget.md          Exact body, without generated front matter
projects/widget.md.json     Full metadata except body, plus original identity
```

This implements the draft’s [§10.2 loading pattern](https://github.com/The-AI-Disclosures-Project/Open-Memory-Protocol/blob/main/working-group/exchange-and-runtime/2026-11-06-working-spec-v0.5.md#102-markdown-loading-profile), using a repository-defined `omp-markdown/0.1` encoding. The draft does not specify these index/sidecar filenames or API methods. No interoperable finalized Markdown encoding is claimed.

Safe relative source paths are lowercased and given an `.md` extension when needed. Unsafe, reserved or colliding paths receive deterministic filenames derived from identity. The original `memory.path` stays in metadata. Root `MEMORY.md` is always the generated index; a memory requesting that path is relocated. Bodies retain their original text and media type, including non-Markdown content. JSON sidecars preserve fields without loss; deleting sidecars or copying only `.md` files loses metadata and the exchange ledger. Paths and immediate-child relationships are validated before calling the reader. The caller owns filesystem/HTTP permissions and the reader’s own resource limits.

## Develop independently

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm sdk:build
pnpm --filter omp-sdk test
pnpm verify
```

The SDK compiles with web-standard types and no Node/Cloudflare ambient types. Consumer checks use the built declarations. Fixtures and tests are regression inputs, not an official certification suite. The package has its own README, license, dependencies and build output; it can be packed without the Cloudflare app.
