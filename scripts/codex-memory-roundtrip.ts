import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { OmpClient } from "./lib/memory-client.ts";
import { ApiError, jsonValue } from "../src/protocol/model.ts";

const execute = promisify(execFile);
const base = process.argv[2] ?? "http://localhost:5173";
const label = "codex-canary-" + crypto.randomUUID();
const secret = crypto.randomUUID();
const memory = new OmpClient(base, "personal", process.env.OMP_API_TOKEN ?? "");
const directory = await mkdtemp(join(tmpdir(), "omp-codex-"));

const eventSchema = z
  .object({
    type: z.string(),
    item: z
      .object({
        type: z.string(),
        server: z.string().optional(),
        tool: z.string().optional(),
        status: z.string().optional(),
      })
      .catchall(jsonValue)
      .optional(),
  })
  .catchall(jsonValue);

async function session(prompt: string) {
  const execution = execute(
    "codex",
    [
      "exec",
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "-C",
      directory,
      "-c",
      "mcp_servers.omp-memory.url=" + JSON.stringify(base.replace(/\/$/u, "") + "/mcp"),
      "-c",
      'mcp_servers.omp-memory.bearer_token_env_var="OMP_API_TOKEN"',
      prompt,
    ],
    { timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
  );

  execution.child.stdin?.end();
  const { stdout } = await execution;

  return stdout
    .trim()
    .split("\n")
    .map((line) => eventSchema.parse(JSON.parse(line)));
}

try {
  await mkdir(join(directory, ".agents/skills"), { recursive: true });
  await cp(
    new URL("../codex/skills/omp-memory", import.meta.url),
    join(directory, ".agents/skills/omp-memory"),
    { recursive: true },
  );

  const saved = await session(
    `Use $omp-memory and only its MCP tools (no shell or local files). Save sample personal memory with identifier ${label}, body "Demo verification value: ${secret}", applies_to user, contributor agent:codex, activation always. Confirm the successful add_memory call.`,
  );

  assert.ok(
    saved.some((event) => event.item?.tool === "add_memory" && event.item.status === "completed"),
    "First session must complete an MCP add_memory call",
  );
  assert.ok((await memory.read(label)).memory.body.includes(secret));
  console.error("PASS fresh Codex session saved sample memory through MCP");

  // This second process receives only the lookup label, never the randomly generated value.
  const recalled = await session(
    `Use $omp-memory and only its MCP tools (no shell or local files). Find the sample personal memory labeled ${label} using search_memories and get_memory with context {}. Reply with its demo verification value.`,
  );

  assert.ok(
    recalled.some(
      (event) => event.item?.tool === "search_memories" && event.item.status === "completed",
    ),
    "Second session must search through MCP",
  );
  assert.ok(
    recalled.some(
      (event) => event.item?.tool === "get_memory" && event.item.status === "completed",
    ),
    "Second session must fetch through MCP",
  );
  assert.ok(
    recalled.some(
      (event) =>
        event.item?.type === "agent_message" && JSON.stringify(event.item).includes(secret),
    ),
    "Fresh session must recall the value absent from its prompt",
  );

  const report = {
    ok: true,
    base,
    sessions: 2,
    checks: [
      "model MCP save",
      "independent REST persistence",
      "fresh model MCP search",
      "fresh model MCP get",
      "random value recalled without prompt leakage",
    ],
    verifiedAt: new Date().toISOString(),
  };

  if (process.argv[3] !== undefined)
    await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    await memory.delete(label);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) {
      console.error("Canary cleanup failed", error);
      process.exitCode = 1;
    }
  }

  await rm(directory, { recursive: true, force: true });
}
