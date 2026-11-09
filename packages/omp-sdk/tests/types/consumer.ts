import { memorySchema, appendContribution, type Memory } from "omp-sdk/core";
import { archive, importedMemories } from "omp-sdk/experimental";
import { collisionMemories } from "omp-sdk/testing";

const memory: Memory = memorySchema.parse({
  identifier: "consumer",
  media_type: "text/plain",
  created_at: "2026-11-09T00:00:00Z",
  body: "Consumer",
});
const attributed = appendContribution(memory, {
  id: "opaque",
  kind: "system",
  contribution: "recorded",
});
const snapshot = archive({
  origin: "source",
  memories: [attributed, ...collisionMemories()],
  tombstones: [],
});
console.log(importedMemories(snapshot).length);

import { exportMarkdown, openMarkdownDirectory } from "omp-sdk/experimental/markdown";
const { files } = exportMarkdown(snapshot);
const directory = await openMarkdownDirectory({
  readFile: async (path) => {
    const value = files.get(path);
    if (value === undefined) throw new Error("Missing file");
    return value;
  },
});
console.log(await directory.readRoot(), await directory.list(), await directory.snapshot());
