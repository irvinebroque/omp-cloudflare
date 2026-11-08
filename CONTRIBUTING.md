# Contributing

Start with the README’s local setup, then run `npm run verify` and `npm run test:quality`. Keep changes focused and include regression evidence when changing persistence, exchange, pagination, authentication or concurrency. The suite uses the real local Artifacts simulator and real MCP clients; module mocks are prohibited by lint.

Preserve unknown metadata, original origins and import receipts. Update `docs/protocol.md` when an experimental contract changes. Update deployment discovery metadata together with `cloudflare.config.ts` and test a clean setup before documenting a new deployment path. Platform beta upgrades should include both local and live validation.

Never commit tokens, exported private memories, local Artifacts state or Cloudflare account IDs. Production deployments use a private runtime token; this example’s two stores share one operator. Report suspected security issues privately through GitHub’s security reporting feature when available, avoiding memory contents and credentials in public issues.
