# Codex integration

This is optional. The HTTP service and browser work without Codex.

Start the local server or deploy your own instance. Export `OMP_API_TOKEN` **before starting Codex**; the registered MCP config reads that variable. For local development its value is `local-development-token-only`. Production uses the private value you configured as `MEMORY_API_TOKEN`.

```sh
export OMP_API_TOKEN=local-development-token-only
npm run codex:setup -- http://localhost:5173/mcp
npm run codex:check
```

Setup verifies `/fmp/info`, registers `omp-memory` using `codex mcp add --url … --bearer-token-env-var OMP_API_TOKEN`, and links `codex/skills/omp-memory` into `~/.agents/skills/omp-memory`. It refuses unrelated skill files or another configured URL. Keep this checkout in place. The skill depends on the registered server name, so no separate endpoint is embedded in its YAML.

For a manual setup, merge [config.example.toml](config.example.toml) into `~/.codex/config.toml` and install the skill. Preserve unrelated settings. This follows the [Codex MCP configuration](https://developers.openai.com/codex/mcp/) and the installed CLI’s help.

Open a fresh Codex session:

```text
Use $omp-memory to save a sample personal preference: I prefer concise TypeScript examples.
```

In another fresh session:

```text
Use $omp-memory to find my response preferences and fetch the matching memories.
```

The skill asks Codex to search, get selected full records, preserve references and provenance, and use read versions when editing or deleting. Memories are attributed data, not higher-priority instructions. MCP availability does not guarantee that a model automatically calls it; invoke the skill explicitly when testing.

`npm run codex:check` launches a fresh app-server and checks discovery of six tools and the installed skill, without requesting model generation. `npm run codex:roundtrip -- "$OMP_URL"` makes two real model requests: one saves a random canary, and a second receives only its lookup label and must retrieve the hidden value through MCP. It requires an authenticated Codex CLI and can incur model usage. The canary is deleted from current views afterward; Git history retains it.

To remove this checkout’s integration:

```sh
npm run codex:setup -- http://localhost:5173/mcp --uninstall
```

Use the same URL originally registered. This removes only the named MCP entry and this checkout’s symlink. It does not erase memories.
