# Live verification

Deployment: https://ompi-memory.roundtrip.workers.dev

Cloudflare account: **Roundtrip**. Deployed Worker version:
`6a723d9e-0537-4f19-8569-250d717c7b0e` (November 6, 2026).

Artifacts namespace: `ompi-memory-prototype`

| Role           | Artifact repository | Repository ID      |
| -------------- | ------------------- | ------------------ |
| Personal store | `personal`          | `se35ivyywaz5m982` |
| Company store  | `company`           | `jfd5mjujqire4dc6` |

This deployment uses Vite+ 1.5.0, strict type-aware lint, and all generic anti-slop rules. Formatting, lint, type checking, the production build, dependency audit (zero known vulnerabilities), and `git diff --check` pass. Live malformed cursors return 400 and requests above 1 MiB return 413. All **30 unit tests** pass, including exact opaque IDs, full MCP metadata, provenance preservation, cleanup failure outcomes, mixed-origin export identities, pagination over 200 matches, a 1,501-entry deletion ledger, and worst-case export page size.

The live reports cover:

- [14 REST round-trip checks](live-roundtrip.json): Artifact persistence across requests, separate stores and gateway routing, cross-store copy and copy-back, conflict handling, concurrent writes, deletion replay prevention, history, and invalid input.
- [Eight MCP round-trip checks](mcp-roundtrip.json): the real HTTP transport, six-tool discovery, writes, provenance, scoped recall, stale edits/deletes, validation, and concurrent edits with one winner.
- [Regression checks](regression-roundtrip.json): exact IDs, stubs/evidence/extensions, unsupported provenance rejection without data loss, paginated cross-store recall, old always-active preferences, stale cursor rejection, mixed-origin copies, and multi-page tombstone transfer with replay prevention.
- [Codex discovery](codex-check.json): a fresh Codex app-server connects to the deployed MCP endpoint, discovers all six tools, and finds the enabled installed skill.
- [Two-session model recall](codex-memory-roundtrip.json): one fresh ephemeral Codex CLI process saves a random sample value using MCP `add_memory`; REST independently verifies persistence. Another fresh process receives only its lookup label, calls MCP `search_memories` and `get_memory`, and returns the random value absent from its prompt. This uses the locally configured model provider. The test removes its canary afterward and keeps no transcript or canary value in the report.

The [deployed browser UI checks](browser-ui.json) exercised cross-store search and a two-page JSONL download, comparing every memory and tombstone with a direct Artifact read. Every downloaded line is a bounded OMP archive page; the copy action imports every page. The memory skill passes the skill-creator validator and remains linked at `~/.agents/skills/omp-memory`.

Independent storage verification bypasses the application:

```sh
cf artifacts namespaces repos files get personal \
  --namespace ompi-memory-prototype --ref main --path omp-state.json --text
```

The command returns the actual Artifact's persisted JSON. Test memories are removed from current views; commits and content-free deletion markers remain intentionally. Two harmless demo notes remain for a `TypeScript` search.

No native Codex internal-memory migration, deterministic startup hook, authenticated isolation, or secure Git-history erasure is claimed. The deletion ledger has no fixed entry cap, but processing remains linear in retained history; this is still a small prototype. Export identity mapping and cursor pagination are documented local extensions, not adopted OMP standards.
