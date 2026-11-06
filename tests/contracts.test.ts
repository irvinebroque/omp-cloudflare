import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { z } from "zod";
import { OmpClient, OmpGateway } from "../sdk/client.ts";
import { decodeResponse, readResponse } from "../src/contracts.ts";
import { ApiError, validateMemory, memorySchema } from "../src/model.ts";
import { memoryVersion } from "../src/runtime.ts";

const memory = validateMemory({
  identifier: "schema-check",
  media_type: "text/plain",
  created_at: "2026-11-06T12:00:00Z",
  body: "Example",
  custom: { nested: [42, null, "preserved"] },
});

test("SDK modules initialize and normalize endpoint URLs", () => {
  assert.equal(new OmpClient("https://example.invalid/").baseUrl, "https://example.invalid");
  assert.equal(new OmpGateway("https://example.invalid/").baseUrl, "https://example.invalid");
});

test("response decoding preserves extensions and rejects malformed success responses", async () => {
  const payload = { memory, version: memoryVersion(memory), commit: "example-commit" };
  assert.deepEqual(await decodeResponse(Response.json(payload), readResponse), payload);
  await assert.rejects(
    decodeResponse(Response.json({ ...payload, memory: { ...memory, body: 42 } }), readResponse),
    z.ZodError,
  );
  await assert.rejects(
    decodeResponse(Response.json({ error: "Conflict" }, { status: 409 }), readResponse),
    new ApiError(409, "Conflict"),
  );
});

test("memory versions survive JSON persistence and absent optional fields", () => {
  const optional = validateMemory({ ...memory, title: undefined });
  const persisted = memorySchema.parse(JSON.parse(JSON.stringify(optional)));
  assert.equal(memoryVersion(optional), memoryVersion(persisted));
  assert.notEqual(memoryVersion({ ...memory, body: "Changed" }), memoryVersion(persisted));
});
