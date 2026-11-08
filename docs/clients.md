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
