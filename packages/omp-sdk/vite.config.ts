import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      core: "src/core/index.ts",
      experimental: "src/experimental/index.ts",
      "experimental/markdown": "src/experimental/markdown.ts",
      testing: "src/testing/index.ts",
    },
    platform: "neutral",
    target: "es2024",
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
  },
});
