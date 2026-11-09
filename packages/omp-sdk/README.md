# @omp-cloudflare/sdk

Experimental TypeScript utilities for the [OMP v0.5 editors’ draft](https://github.com/The-AI-Disclosures-Project/Open-Memory-Protocol/blob/main/working-group/exchange-and-runtime/2026-11-06-working-spec-v0.5.md). This community package is developed in this repository; it is not an official OMP SDK or a claim of complete conformance. No package is published by the workspace build.

## Entry points

| Import                                        | Contents                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@omp-cloudflare/sdk/core`                    | Memory, contributor and JSON types; lossless schema validation; identity keys; deterministic JSON comparison; explicit provenance appending                |
| `@omp-cloudflare/sdk/experimental`            | The `omp-cloudflare-references/0.1` convention, copy envelopes, reversible identity mapping, dangling-reference diagnostics, lifecycle and context helpers |
| `@omp-cloudflare/sdk/bindings/omp-cloudflare` | This server's HTTP request/response contracts, `OmpClient`, and `OmpGateway`                                                                               |
| `@omp-cloudflare/sdk/testing`                 | Valid and invalid metadata fixtures and a fresh mixed-origin collision fixture                                                                             |

The package exports ESM JavaScript and TypeScript declarations. Its source uses web APIs and portable hashing, without Node or Cloudflare imports. It targets ES2024 runtimes with `fetch`, `TextEncoder`, `URLSearchParams`, and `structuredClone`.

## Validate and attribute a memory

```ts
import { appendContribution, memorySchema } from "@omp-cloudflare/sdk/core";

const memory = memorySchema.parse({
  identifier: "preferences",
  media_type: "text/plain",
  created_at: "2026-11-09T00:00:00Z",
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

Unknown JSON metadata survives parsing, including nested contributor extensions. Attribution is explicit: `appendContribution` neither infers a contributor's kind from its ID nor invents an original author. Core validation has no deployment quota for body size or memory count. Applications must enforce their own request, resource and credential policies.

`key(memory, fallbackOrigin)` constructs an identity key; `stable(value)` supports deterministic JSON comparison. Neither is a portable checksum or revision-comparison standard. The `x_omp_origin` field is this implementation's experimental convention for retaining a memory's source origin.

## Exchange without a server

```ts
import { archive, archiveSchema, importedMemories } from "@omp-cloudflare/sdk/experimental";

const snapshot = archive({
  origin: "example:source",
  memories: [attributed],
  tombstones: [],
});
const parsed = archiveSchema.parse(JSON.parse(JSON.stringify(snapshot)));
const restored = importedMemories(parsed);
```

The envelope supports the example's `minimal`/`copy` binding with snapshots and selections. Manifest and tombstone shapes are experimental. Colliding identifiers are aliased consistently across recognized links, evidence targets and exact `[[identifier]]` references in plain text or Markdown. The identity map restores original identities on import. Unknown reference shapes remain opaque. A checksummed memory that would need rewriting causes an error instead of acquiring a stale checksum.

`danglingReferences` reports missing recognized targets separately from memory objects. `currentMemories` excludes expired, future and superseded memories using this convention. `applicable`, `validateContext`, and `validateConventions` implement the example's repository/path/activation convention. These helpers do not enforce ACLs, select a ranking algorithm, implement storage, or merge conflicting revisions.

## Use the Cloudflare example's HTTP binding

```ts
import { OmpClient } from "@omp-cloudflare/sdk/bindings/omp-cloudflare";

const client = new OmpClient("https://your-worker.workers.dev", "personal", accessKey);
const saved = await client.remember({ body: "Prefer concise answers." }, "agent:example");
await client.read(saved.memory.identifier, saved.memory.x_omp_origin);
const complete = await client.snapshot();
```

`OmpClient` supports discovery, remember, read, search, update, delete, export, import and history. Optional contributor/context arguments are supported; update/delete take the server's opaque `if_version` token. `snapshot(origin?)` collects every export page before labelling the result a snapshot. `importSnapshot` sends tombstones in bounded batches and returns the first batch's memory receipts; it is not an atomic transaction. `OmpGateway` searches across the example's two stores and routes writes explicitly.

These clients speak `/stores/{personal|company}/fmp/*` and `/gateway/*`. Those routes, bearer authentication, concurrency tokens and Git commit responses are implementation bindings, not a general OMP transport specification.

## Develop

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm sdk:build
pnpm --filter @omp-cloudflare/sdk test
pnpm verify
```

The app consumes this package through `workspace:*` and its built public exports. Build before running package consumers directly. Shared fixtures are regression inputs, not an official certification suite. See the repository's [protocol coverage](../../CONFORMANCE.md) for the app's policy and unsupported profiles.
