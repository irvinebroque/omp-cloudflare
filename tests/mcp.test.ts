import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createServer } from "../src/mcp.ts";
import { ApiError, objectSchema, text, validateMemory } from "../src/model.ts";
import { selectMemory, memoryVersion } from "../src/runtime.ts";
import { readResponse } from "../src/contracts.ts";

// Exercise the real MCP schemas and serialization through the SDK transport.
test("MCP preserves opaque identity whitespace and all interpretation metadata", async () => {
  const memory = validateMemory({
    identifier: " padded ",
    x_omp_origin: " origin ",
    media_type: "text/plain",
    created_at: "2026-11-06T00:00:00Z",
    body: "See evidence",
    stub: true,
    evidence: { uri: "https://example.test/full" },
    provenance: { source: "legacy" },
    custom: [1, 2],
  });

  const server = createServer(async (request) => {
    const input = objectSchema.parse(await request.json());

    try {
      const selected = selectMemory(
        { origin: "local", memories: [memory], tombstones: [] },
        { identifier: text(input.identifier, "identifier"), origin: text(input.origin, "origin") },
      );

      return Response.json({ memory: selected, version: memoryVersion(selected), commit: "test" });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Failure" },
        { status: error instanceof ApiError ? error.status : 503 },
      );
    }
  }, new URL("https://example.test"));

  const client = new Client({ name: "regression-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const response = await client.callTool({
      name: "get_memory",
      arguments: {
        store: "personal",
        identifier: memory.identifier,
        origin: memory.x_omp_origin,
        context: {},
      },
    });

    assert.notEqual(response.isError, true);
    const projected = readResponse.omit({ commit: true }).parse(response.structuredContent);
    assert.deepEqual(projected.memory, memory);
    assert.equal(projected.version, memoryVersion(memory));
  } finally {
    await client.close();
    await server.close();
  }
});
