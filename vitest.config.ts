import { defineConfig } from "vite-plus";

// Pure model/runtime unit tests run in Node and never contact deployed Artifacts.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], environment: "node" } });
