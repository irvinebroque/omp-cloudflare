# Anti-slop provenance

Source: https://github.com/dmmulroy/anti-slop

Exact source commit: `13909c9e07590f5a85d93c62712259fe14a883f7`.

Installed with that revision's `skills/install-anti-slop/scripts/install.mjs` from
`skills/install-anti-slop/assets/anti-slop/` into this directory. The generic
plugin is enabled in `vite.config.ts`; the bundled Effect plugin is retained but
not enabled because this project has no direct Effect dependency.

Intentional deviation: Vite+ migration rewrote `@oxlint/plugins` imports to
`vite-plus/lint/plugins`. This uses Vite+ 1.5.0's matching Oxlint 1.91.0 plugin
API without a separately versioned Oxlint installation. Rule implementations and
diagnostics are otherwise unchanged. `LICENSE` is the source repository's license.
The nested Stylistic vendor retains its own license and provenance.
