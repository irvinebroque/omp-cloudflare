import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      core: "src/core/index.ts",
      experimental: "src/experimental/index.ts",
      "bindings/omp-cloudflare": "src/bindings/omp-cloudflare.ts",
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
