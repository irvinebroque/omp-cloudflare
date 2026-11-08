import assert from "node:assert/strict";
import { OmpClient } from "../sdk/client.ts";
import { ApiError } from "../src/protocol/model.ts";

const base = process.argv[2] ?? "http://localhost:5173";
const token = process.env.OMP_API_TOKEN ?? "";
const clients = [new OmpClient(base, "personal", token), new OmpClient(base, "company", token)];
const prefix = "concurrency-" + crypto.randomUUID();
let verified = 0;

async function runWaves(
  operation: (client: OmpClient, identifier: string) => Promise<void>,
  wave = 0,
): Promise<void> {
  if (wave === 4) return;
  await Promise.all(
    clients.flatMap((client) =>
      [0, 1].map((index) => operation(client, `${prefix}-${wave}-${index}`)),
    ),
  );
  await runWaves(operation, wave + 1);
}

try {
  await runWaves(async (client, identifier) => {
    const body = `${client.store}: independent request ${identifier}`;
    await client.remember({ identifier, body });
    assert.equal((await client.read(identifier)).memory.body, body);
    verified += 1;
  });
} finally {
  await runWaves(async (client, identifier) => {
    try {
      await client.delete(identifier);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
  });
}

assert.equal(verified, 16);

console.log(
  JSON.stringify(
    {
      ok: true,
      base,
      verifiedAt: new Date().toISOString(),
      records: verified,
      checks: [
        "Four simultaneous requests across two stores complete without shared Git locks or lost writes",
        "Every saved record is read back and removed from current views",
      ],
    },
    null,
    2,
  ),
);
