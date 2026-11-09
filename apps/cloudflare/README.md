# Cloudflare OMP example

This app runs memory stores on Cloudflare Workers and Artifacts, with a chat agent, browser UI, HTTP API and MCP binding. See the [repository README](../../README.md) for deployment and Git cloning.

It consumes the provider-neutral [`omp-sdk`](../../packages/omp-sdk) through `workspace:*` and built public exports. The SDK never imports this app. Replacing Cloudflare storage or transport does not require changing the SDK.

The app owns:

- Artifacts repositories, Git commits/locking, Durable Objects and Cloudflare deployment configuration.
- Bearer authentication, personal/company routing, deployment quotas, credential rejection, migration and conflict policy.
- HTTP and MCP bindings, request pagination, concurrency tokens, Git history responses and the browser/chat experience.
- Repository/path activation policy and the demo’s HTTP client/contracts in [`src/client`](src/client). That client speaks this app’s routes; it is not a universal OMP transport.

## Export a Markdown directory

From the repository root, set `OMP_API_TOKEN` to the deployed app’s access key and run:

```sh
pnpm memory:markdown https://your-worker.workers.dev "$PWD/my-memory" personal
```

The output directory must be new. This command fetches all snapshot pages through the app’s HTTP client, asks the SDK to project the snapshot, and writes the returned files using Node’s filesystem. Begin with `my-memory/MEMORY.md`. No Cloudflare-specific code is needed to read that exported directory; use the SDK’s `openMarkdownDirectory({ readFile })` with a filesystem, Git or HTTP reader.

The generated directory is an exchange projection. The raw Artifacts Git checkout has the app’s storage format; it is not itself the SDK’s Markdown directory format. Exporting Markdown does not change the storage format or introduce live file synchronization.

For example, code inside this app can compose the two layers explicitly:

```ts
import { OmpClient } from "./src/client/index.ts";
import { exportMarkdown } from "omp-sdk/experimental/markdown";

const client = new OmpClient(workerUrl, "personal", accessKey);
const { files } = exportMarkdown(await client.snapshot());
```

`OmpClient` supports discovery, remember, read, search, update, delete, export, import and history. `snapshot(origin?)` collects all pages before marking the envelope complete. `importSnapshot` batches tombstones and is not atomic. `OmpGateway` searches both stores and routes writes explicitly. These contracts and their authentication/concurrency behavior belong to this implementation.

## Contributor and scope requirements

Authoring APIs take an explicit contributor object, for example `{ id: "agent:example", kind: "agent" }`, using the draft’s contributor fields. ID prefixes do not determine kind. Contributor strings are rejected; callers migrating from the former string argument must supply `id` and `kind`. Omission records the known storage process as a system contributor, without inventing an original author. The app records its actual write time, independently of a supplied historical `created_at`.

`scope` belongs to the serving system. Authoring and update requests cannot assign it. Imports retain external scope metadata as claims; those tags never grant access. This single-operator app does not implement scope-based ACLs. Its `/fmp/info` response declares the comparison of imported opaque `memory.version` values; response `version` tokens separately guard conditional writes.
