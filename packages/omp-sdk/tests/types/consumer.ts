import { memorySchema, appendContribution, type Memory } from "@omp-cloudflare/sdk/core";
import { archive, importedMemories } from "@omp-cloudflare/sdk/experimental";
import { OmpClient, OmpGateway } from "@omp-cloudflare/sdk/bindings/omp-cloudflare";
import { collisionMemories } from "@omp-cloudflare/sdk/testing";

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
console.log(
  importedMemories(snapshot).length,
  new OmpClient("https://example.invalid"),
  new OmpGateway("https://example.invalid"),
);
