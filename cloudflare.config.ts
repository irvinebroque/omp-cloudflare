import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => ({
  worker: {
    name: process.env.WORKERS_CI_WORKER_NAME ?? process.env.OMP_WORKER_NAME ?? "omp-cloudflare",
    compatibilityDate: "2026-11-08",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    env: {
      ARTIFACTS: bindings.artifacts({
        namespace: process.env.OMP_NAMESPACE ?? "omp-cloudflare",
        dev: { remote: false },
      }),
      MEMORY_API_TOKEN:
        mode === "development" || mode === "test"
          ? bindings.text("local-development-token-only")
          : bindings.secret(),
    },
    observability: { enabled: true, headSamplingRate: 1 },
  },
}));
