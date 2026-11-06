import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { revokeWriteToken } from "../src/storage.ts";

test("failed token cleanup preserves a successful commit result", async () => {
  const committed = { commit: "committed" };

  async function write() {
    try {
      return committed;
    } finally {
      await revokeWriteToken(() => Promise.reject(new Error("cleanup failed")));
    }
  }

  assert.deepEqual(await write(), { commit: "committed" });
});

test("failed token cleanup preserves the primary write error", async () => {
  const primary = new Error("push failed");

  async function write() {
    try {
      throw primary;
    } finally {
      await revokeWriteToken(() => Promise.reject(new Error("cleanup failed")));
    }
  }

  await assert.rejects(write(), (error) => error === primary);
});
