import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { z } from "zod";
import { chatView } from "../src/agent/contracts.ts";
import { OmpClient } from "./lib/memory-client.ts";

const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/u, "");
const token = process.env.OMP_API_TOKEN;

if (token === undefined)
  throw new Error(
    "Set OMP_API_TOKEN. This suite makes real model calls and saves disposable sample data.",
  );

const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
const client = new OmpClient(base, "personal", token);
const marker = "sample-project-" + crypto.randomUUID().slice(0, 8);
const fact = "Violet " + String(crypto.getRandomValues(new Uint32Array(1))[0]);
const first = base + "/api/chat/" + crypto.randomUUID();
const second = base + "/api/chat/" + crypto.randomUUID();
const company = second + "?store=company";
const receiptSchema = z.object({ accepted: z.boolean(), operationId: z.string() });

async function submit(url: string, prompt: string, operationId = crypto.randomUUID()) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt, operationId }),
  });

  assert.equal(response.status, 202, await response.clone().text());

  return receiptSchema.parse(await response.json());
}

async function finish(url: string, attempt = 0): Promise<z.infer<typeof chatView>> {
  if (attempt >= 180) throw new Error("Agent did not finish within 180 seconds");

  const response = await fetch(url, { headers });

  assert.equal(response.status, 200, await response.clone().text());

  const view = chatView.parse(await response.json());

  if (!view.busy && (view.failure !== null || view.messages.some((m) => m.role === "assistant"))) {
    assert.equal(view.failure, null, JSON.stringify(view));

    return view;
  }

  await pause(1000);

  return finish(url, attempt + 1);
}

try {
  const operationId = crypto.randomUUID();
  const prompt = `Remember this sample project preference: for ${marker}, use ${fact} as the document heading.`;
  assert.equal((await submit(first, prompt, operationId)).accepted, true);
  assert.equal((await submit(first, prompt, operationId)).accepted, false);
  const saved = await finish(first);
  assert.ok(
    saved.messages.some((m) => m.role === "tool" && m.text === "remember completed"),
    JSON.stringify(saved),
  );
  const memories = await client.search(marker);
  assert.equal(memories.total, 1);
  assert.equal(memories.memories[0]?.body.includes(fact), true);
  const fresh = chatView.parse(await (await fetch(second, { headers })).json());
  assert.deepEqual(fresh.messages, []);
  await submit(second, `What document heading should I use for ${marker}? Look it up in memory.`);
  const recalled = await finish(second);
  assert.ok(
    recalled.messages.some((m) => m.role === "assistant" && m.text.includes(fact)),
    JSON.stringify(recalled),
  );
  assert.ok(
    recalled.messages.some((m) => m.role === "tool" && m.text === "search_memories completed"),
  );
  assert.ok(recalled.messages.some((m) => m.role === "tool" && m.text === "read_memory completed"));
  const resumed = chatView.parse(await (await fetch(second, { headers })).json());
  assert.deepEqual(resumed.messages, recalled.messages);
  const isolated = chatView.parse(await (await fetch(company, { headers })).json());
  assert.deepEqual(isolated.messages, []);
  const companyMemories = await new OmpClient(base, "company", token).search(marker);
  assert.equal(companyMemories.total, 0);
  console.log(
    JSON.stringify(
      {
        base,
        timestamp: new Date().toISOString(),
        checks: [
          "real Pi remember tool",
          "durable submission replay deduplicated",
          "one OMP record saved",
          "fresh transcript",
          "real search and read tools",
          "cross-chat recall",
          "reconnect persistence",
          "store isolation",
        ],
        passed: true,
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.all(
    (await client.search(marker)).memories.map(async (memory) => {
      const current = await client.read(memory.identifier, memory.x_omp_origin);
      await client.delete(memory.identifier, memory.x_omp_origin, current.version);
    }),
  );
}
