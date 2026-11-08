import { bindings, defineConfig, exports } from "cf/config";
import { project } from "./scripts/project-settings.ts";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => ({
  worker: {
    name: process.env.OMP_WORKER_NAME ?? project.name,
    compatibilityDate: project.compatibility_date,
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    exports: { MemoryAgent: exports.durableObject({ storage: "sqlite" }) },
    env: {
      MemoryAgent: bindings.durableObject({
        worker: process.env.OMP_WORKER_NAME ?? project.name,
        exportName: "MemoryAgent",
      }),
      AI: bindings.ai({ dev: { remote: process.env.OMP_REMOTE_AI === "true" } }),
      CHAT_MODEL: bindings.text("@cf/zai-org/glm-5.3-flash"),
      ARTIFACTS: bindings.artifacts({
        namespace: process.env.OMP_NAMESPACE ?? project.name,
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
