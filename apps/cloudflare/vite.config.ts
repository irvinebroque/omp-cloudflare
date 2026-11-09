import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, lazyPlugins } from "vite-plus";
import { fileURLToPath } from "node:url";

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
