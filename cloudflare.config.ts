import { bindings, defineConfig } from "cf/config";
import { project } from "./scripts/project-settings.ts";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => ({
  worker: {
    name: process.env.OMP_WORKER_NAME ?? project.name,
    compatibilityDate: project.compatibility_date,
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    env: {
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
