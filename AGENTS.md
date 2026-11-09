# Working in this repository

Use Cloudflare CLI (`cf`) for Cloudflare development, deployments and resources. Read https://developers.cloudflare.com/cf/get-started/ and discover commands with `cf cli search` before inspecting a discovered command’s help. Do not add account IDs or credentials to source.

Use Vite+ for checks, tests, builds and script execution. `pnpm dev/build` invoke `cf`, which delegates to Vite+. Use `vpx` for TypeScript scripts. Keep all lint settings in `vite.config.ts`, including type-aware/type-check modes and deny-warnings checks.

Follow [Dillon Mulroy's anti-slop guidance](https://github.com/dmmulroy/anti-slop): validate external input, preserve known types, prefer direct typed calls, and test real dependencies. Keep this example small; do not vendor lint plugins or installer skills. Fix findings without suppressions, unsafe casts, broad types, or weakening strict settings. The custom anti-slop rules are not installed; Vite+'s native checks enforce formatting, type safety, and correctness.

Protocol behavior follows the OMP editors’ draft linked in the README. Preserve unknown JSON metadata and original identity. Never present experimental routes, runtime conventions or this repository as adopted OMP standards.

Run `pnpm verify` before pushing. E2E uses isolated local state. Live checks write disposable sample records and retain content in Git history; run only against an account you are authorized to use. Record live/browser/model checks accurately in the pull request; do not claim a deploy-button success from a successful CLI deployment alone.

This is a pnpm workspace. `packages/omp-sdk` contains portable protocol utilities and explicit experimental/binding entry points; `apps/cloudflare` owns storage, authentication, migration, deployment quotas and credential policy. Consume SDK public package exports via `workspace:*`, never relative imports into its source. Build the SDK before running consumers directly.
