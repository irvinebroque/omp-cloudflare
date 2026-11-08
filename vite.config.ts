import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, lazyPlugins } from "vite-plus";
import { fileURLToPath } from "node:url";

const ignored = [
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".gemini/**",
  ".opencode/**",
  ".pi/**",
  ".roo/**",
  ".windsurf/**",
  "codex/skills/**",
  "tools/oxlint/anti-slop/**",
  ".cloudflare/**",
  ".wrangler/**",
  "dist/**",
];

export default defineConfig({
  define: {
    "import.meta.env.VITE_OMP_REMOTE_AI": JSON.stringify(process.env.OMP_REMOTE_AI === "true"),
  },
  environments: { ssr: { optimizeDeps: { exclude: ["async-lock"] } } },
  resolve: {
    alias: [
      {
        find: /^async-lock$/u,
        replacement: fileURLToPath(new URL("./src/storage/git-lock.ts", import.meta.url).href),
      },
    ],
  },
  fmt: { ignorePatterns: ignored },
  lint: {
    ignorePatterns: ignored,
    plugins: ["typescript", "unicorn", "oxc", "import", "promise"],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    ],
    categories: { correctness: "error", suspicious: "error", perf: "error" },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "oxc/no-accumulating-spread": "error",
      "anti-slop/no-array-filter-map": "error",
      "anti-slop/no-reduce-accumulator-copy": "error",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-readable-spacing": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
      "typescript/no-explicit-any": "error",
      "typescript/strict-boolean-expressions": "error",
      "typescript/no-unsafe-type-assertion": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/no-unsafe-assignment": "error",
      "typescript/no-unsafe-argument": "error",
      "typescript/no-unsafe-call": "error",
      "typescript/no-unsafe-member-access": "error",
      "typescript/no-unsafe-return": "error",
      "typescript/no-unnecessary-type-assertion": "error",
      "typescript/switch-exhaustiveness-check": "error",
      "typescript/consistent-type-imports": "error",
    },
    options: { typeAware: true, typeCheck: true },
  },
  test: { include: ["tests/**/*.test.ts"] },
  server: { port: Number(process.env.OMP_PORT ?? "5173"), strictPort: true },
  plugins:
    lazyPlugins(() =>
      process.env.VITEST === "true"
        ? []
        : [
            cloudflare({
              inspectorPort: false,
              persistState: { path: process.env.OMP_STATE_DIR ?? ".cloudflare/state" },
              remoteBindings: process.env.OMP_REMOTE_AI === "true",
            }),
          ],
    ) ?? [],
});
