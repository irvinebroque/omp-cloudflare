import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  accountId: "6ca3fa16f4f94a6d565cdf361cab3b48", // Roundtrip
  worker: {
    name: "ompi-memory",
    compatibilityDate: "2026-11-06",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    env: { ARTIFACTS: bindings.artifacts({ namespace: "ompi-memory-prototype" }) },
    observability: { enabled: true, headSamplingRate: 1 },
  },
});
