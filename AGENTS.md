# Working in this repository

Use Cloudflare CLI (`cf`) for Cloudflare development, deployments and resources. Read https://developers.cloudflare.com/cf/get-started/ and discover commands with `cf cli search` before inspecting a discovered command’s help. Do not add account IDs or credentials to source.

Use Vite+ for checks, tests, builds and script execution. `npm run dev/build` invoke `cf`, which delegates to Vite+. Use `vpx` for TypeScript scripts. Keep all lint settings in `vite.config.ts`, including type-aware/type-check modes and deny-warnings checks.

Read and apply [.agents/skills/install-anti-slop/SKILL.md](.agents/skills/install-anti-slop/SKILL.md) when changing the vendored rules or their configuration. All generic anti-slop rules are enabled as errors. Preserve the recorded upstream revision, licenses and Vite+ import adaptation. No Effect rules are needed without an Effect dependency. Fix application code rather than adding suppressions, unsafe casts, broad types, or weakening strict settings.

Protocol behavior follows the linked editors’ draft and the explicit experimental contract in `docs/protocol.md`. Preserve unknown JSON metadata and original identity. Never present experimental routes, runtime conventions or this repository as adopted OMP standards.

Run `npm run verify` and `npm run test:quality` before pushing. E2E uses isolated local state and needs Python 3.10+. Live checks write disposable sample records and retain content in Git history; run only against an account you are authorized to use. Record live/browser/model checks accurately in `docs/validation.md`; do not claim a deploy-button success from a successful CLI deployment alone.
