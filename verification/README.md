# Live verification

Deployment: https://ompi-memory.roundtrip.workers.dev

Cloudflare account: **Roundtrip**

Worker version: `63b61258-1f05-41a1-8e48-eb8738d13204` (MCP verification; see the final deployment below)

Final deployed version: `ee8f5786-c4e6-4978-8089-8890b86ef17a`. The final deployment adds the browser's Codex setup link and removes an unused import; MCP/storage behavior is unchanged. A read-only MCP handshake/capabilities check also passed after this deployment.

Artifacts namespace: `ompi-memory-prototype`

| Role           | Artifact repository | Repository ID      |
| -------------- | ------------------- | ------------------ |
| Personal store | `personal`          | `se35ivyywaz5m982` |
| Company store  | `company`           | `jfd5mjujqire4dc6` |

Fifteen unit tests and all 14 live REST checks passed on November 6, 2026. See [live-roundtrip.json](live-roundtrip.json) for the source/destination Artifacts commit hashes and assertions. The live test uses separate HTTP requests for persistence verification, exports a memory to the other store, then exports it back and verifies its identity and extension fields. It also checks federated gateway search, explicit routing, and simultaneous writes.

All eight [MCP round-trip checks](mcp-roundtrip.json) passed against the real deployment using the official TypeScript MCP client. These cover initialization, tool/resource discovery, personal/company writes, runtime projection, contributor provenance, repository/path/on-request filtering, stale edit/deletion rejection, and simultaneous edits from the same version. One simultaneous edit wins and the other receives a conflict; unrelated records do not invalidate a memory's version.

A fresh `codex-cli 0.162.1` app-server initialized the deployed server, discovered all six tools, and found the enabled installed skill. See [codex-check.json](codex-check.json). This checks Codex's own MCP transport and skill discovery without model generation or a new conversation. The standalone CLI was not signed in for a model-generated recall test. Setup was run twice to verify reuse without duplicate entries; the server was registered in the existing local Codex configuration and the skill linked into `~/.agents/skills/omp-memory`.

The skill passed the skill-creator validator. TypeScript, production build, `git diff --check`, and dependency audit also passed. No native Codex internal-memory migration or deterministic startup hook is claimed. See [Codex setup and conventions](../codex/README.md).

Independent storage verification used the `cf` CLI, bypassing the application:

```sh
cf artifacts namespaces repos files get personal \
  --namespace ompi-memory-prototype --ref main --path omp-state.json --text
```

The command returned the persisted memory JSON from the actual Artifact. The two early scratch repositories were deleted; only the personal and company stores are connected. Smoke-test objects were removed from current views. Their commits remain in history, as documented. The live demo includes two harmless example notes to try a `TypeScript` search across stores.

Dependency audit: zero known vulnerabilities at verification time.
