import { defineConfig } from "vite-plus";

const ignored = ["**/.cloudflare/**", "**/.wrangler/**", "**/dist/**"];

export default defineConfig({
  fmt: { ignorePatterns: ignored },
  lint: {
    ignorePatterns: ignored,
    plugins: ["typescript", "unicorn", "oxc", "import", "promise"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    categories: { correctness: "error", suspicious: "error", perf: "error" },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "oxc/no-accumulating-spread": "error",
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
  test: { include: ["apps/*/tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"] },
});
