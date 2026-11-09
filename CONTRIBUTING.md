# Contributing

Use [Node 24.22.0](.node-version).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

This starts local memory APIs without credentials. For the chat agent, use the [local chat setup](README.md#run-locally).

## Check a change

```sh
pnpm verify
```

`verify` runs strict checks, unit tests, production builds, and the isolated HTTP/MCP/concurrency/exchange/conformance suite. It needs no Cloudflare credentials.

Include regression evidence when changing persistence, exchange, pagination, authentication, or concurrency. Test with the real local simulator and MCP clients rather than module mocks.

Preserve unknown metadata, original origins, and import receipts. Describe experimental contract changes in the pull request. Keep root deployment discovery metadata and `apps/cloudflare/cloudflare.config.ts` in sync, and test a clean setup before documenting a new deployment path. Platform beta upgrades need local and live validation.

```sh
pnpm format  # format files
pnpm check   # formatting, lint, and types
pnpm build   # production build
```

Vite+ runs the formatter, lint, type checks, tests, builds, and TypeScript scripts. Cloudflare development and deployment use `cf`. Shared strict checks live in root `vite.config.ts`; app and SDK build configurations live in their package directories. Use `pnpm sdk:build` to build only the SDK. Root verification checks both packages and runs the app against their built public exports.

Keep strict settings and fix findings without suppressions. Follow [Dillon Mulroy’s anti-slop guidance](https://github.com/dmmulroy/anti-slop); its custom plugin is not installed.

## Find the code

```text
packages/omp-sdk/src/core/          Portable types, validation and explicit provenance
packages/omp-sdk/src/experimental/  Versioned exchange, references and runtime conventions
packages/omp-sdk/src/bindings/      Implementation-specific HTTP client and contracts
packages/omp-sdk/src/testing/       Shared conformance fixtures
packages/omp-sdk/tests/             Tests against built public package exports
apps/cloudflare/src/agent/         Pi harness and memory tools
apps/cloudflare/src/protocol/      Application quotas, migration and mutation policy
apps/cloudflare/src/storage/       Artifacts storage and Git commits
apps/cloudflare/src/server/        HTTP, MCP, authentication and routing
apps/cloudflare/src/web/           Browser chat UI
apps/cloudflare/scripts/           Deployment and integration verification
apps/cloudflare/tests/             Application unit tests
```

## Reset local data

Stop the development server, then remove `apps/cloudflare/.cloudflare/state`. This resets local memories and conversations. Use `OMP_STATE_DIR` and `OMP_PORT` to override the local state directory and port.

## Protect private data

Never commit tokens, exported private memories, local state, or Cloudflare account IDs. Both stores share one access key. Report suspected security issues privately through GitHub's security reporting feature when available, keeping memory contents and credentials out of public issues.
