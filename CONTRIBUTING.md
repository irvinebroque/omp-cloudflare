# Contributing

Use [Node 24.22.0](.node-version).

```sh
npm ci
npm run dev
```

This starts local memory APIs without credentials. For the chat agent, use the [local chat setup](README.md#run-locally).

## Check a change

```sh
npm run verify
```

`verify` runs strict checks, 21 unit tests, production builds, and the isolated HTTP/MCP/concurrency/exchange suite. It needs no Cloudflare credentials. [Validation details](docs/validation.md).

Include regression evidence when changing persistence, exchange, pagination, authentication, or concurrency. Test with the real local simulator and MCP clients rather than module mocks.

Preserve unknown metadata, original origins, and import receipts. Update `docs/protocol.md` when an experimental contract changes. Keep deployment discovery metadata and `cloudflare.config.ts` in sync, and test a clean setup before documenting a new deployment path. Platform beta upgrades need local and live validation.

```sh
npm run format  # format files
npm run check   # formatting, lint, and types
npm run build   # production build
```

Vite+ runs the formatter, lint, type checks, tests, builds, and TypeScript scripts. Cloudflare development and deployment use `cf`. Configuration lives in `vite.config.ts` and `cloudflare.config.ts`.

Keep strict settings and fix findings without suppressions. Follow [Dillon Mulroy’s anti-slop guidance](https://github.com/dmmulroy/anti-slop); its custom plugin is not installed.

## Find the code

```text
src/agent/       Pi harness and memory tools
src/protocol/    Validation and exchange
src/storage/     Artifacts storage and Git commits
src/server/      HTTP, MCP, authentication, and routing
src/web/         Browser chat UI
scripts/         Deployment, setup, and verification
scripts/lib/     Internal HTTP client for verification
codex/           MCP configuration and memory skill
tests/           Unit tests
```

## Reset local data

Stop the development server, then remove `.cloudflare/state`. This resets local memories and conversations. [Deployment configuration](docs/deployment.md) covers alternate state directories and ports.

## Protect private data

Never commit tokens, exported private memories, local state, or Cloudflare account IDs. Both stores share one access key. Report suspected security issues privately through GitHub's security reporting feature when available, keeping memory contents and credentials out of public issues.
