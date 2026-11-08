# Use memory from code

Run commands from the repository root with the server running. Set the connection for your local server:

```sh
export OMP_API_TOKEN=local-development-token-only
export OMP_URL=http://localhost:5173
```

For a deployed instance, use your Worker URL and its access key instead.

## HTTP

```sh
curl "$OMP_URL/gateway/fmp/upload/inferences" \
  -H "Authorization: Bearer $OMP_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"store":"personal","memory":{"identifier":"answer-style","body":"Prefer concise answers with working code.","media_type":"text/markdown","protocol_version":"0.5"}}'

curl "$OMP_URL/gateway/fmp/search" \
  -H "Authorization: Bearer $OMP_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"concise"}'
```

## TypeScript

Use the SDK included in this checkout. Save this as `example.ts` in the repository root:

```ts
import { OmpClient, OmpGateway } from "./sdk/client.ts";

const url = process.env.OMP_URL ?? "http://localhost:5173";
const token = process.env.OMP_API_TOKEN ?? "local-development-token-only";
const gateway = new OmpGateway(url, token);
const personal = new OmpClient(url, "personal", token);
const company = new OmpClient(url, "company", token);

const saved = await gateway.remember({
  identifier: crypto.randomUUID(),
  body: "Use TypeScript for examples.",
  custom_metadata: { preserve_me: true },
});
const current = await personal.read(saved.memory.identifier);
await personal.update(
  current.memory.identifier,
  { body: "Use TypeScript with strict checks." },
  current.memory.x_omp_origin,
  current.version,
);

// snapshot() collects every tombstone page; importSnapshot() sends bounded requests.
const snapshot = await personal.snapshot();
const received = await company.importSnapshot(snapshot);
console.log(received.receipts); // accepted, unchanged, or rejected for each memory
```

Run it with Vite+:

```sh
npx vpx example.ts
```

Always inspect import receipts. Conflicting content at an existing identity is rejected; a repeated identical copy is unchanged. Imported memories retain their origin and are immutable here. To revise one, author a new local memory. Updates and deletes accept `if_version`; MCP requires it. On a 409, read again and reconcile.

## MCP

The MCP endpoint is **`<your-worker-url>/mcp`**, using Streamable HTTP and `Authorization: Bearer <your-token>`.

| Tool              | Purpose                                                      |
| ----------------- | ------------------------------------------------------------ |
| `about_omp`       | Discover capabilities, limits, and experimental conventions  |
| `search_memories` | Search applicable summaries across both stores               |
| `get_memory`      | Retrieve the complete memory, provenance, and version        |
| `add_memory`      | Create a memory in an explicit store                         |
| `update_memory`   | Revise local content using the version just read             |
| `delete_memory`   | Remove current content and write a replay-blocking tombstone |

For Codex, follow the [setup guide](../codex/README.md).
