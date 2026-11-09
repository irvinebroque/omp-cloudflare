import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exportMarkdown } from "omp-sdk/experimental/markdown";
import { OmpClient, storeSchema } from "../src/client/index.ts";

const base = process.argv[2];
const destination = process.argv[3];
if (base === undefined || destination === undefined)
  throw new Error(
    "Usage: pnpm memory:markdown <worker-url> <new-output-directory> [personal|company]",
  );
const store = storeSchema.parse(process.argv[4] ?? "personal");
const client = new OmpClient(base, store, process.env.OMP_API_TOKEN ?? "");
const { files } = exportMarkdown(await client.snapshot());
const output = resolve(destination);

// A fresh directory prevents mixing an export with an old or locally edited one.
await mkdir(output);
await Promise.all(
  [...files].map(async ([path, content]) => {
    const filename = resolve(output, path);
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, content, { flag: "wx" });
  }),
);
console.log(`Exported ${files.size} files to ${output}; start with MEMORY.md.`);
