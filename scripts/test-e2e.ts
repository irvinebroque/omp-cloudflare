import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { ApiError } from "../src/protocol/model.ts";
import { OmpClient } from "../sdk/client.ts";

const temporary = await mkdtemp(join(tmpdir(), "omp-e2e-"));
const port = process.env.OMP_E2E_PORT ?? "5191";
const base = "http://localhost:" + port;
const token = "local-development-token-only";
const client = new OmpClient(base, "personal", token);
let server: ChildProcess | undefined;
let output = "";

function run(command: string, args: string[], env = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(command + " exited " + code)),
    );
  });
}

async function start(state: string) {
  output = "";
  server = spawn("npm", ["run", "dev"], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, OMP_PORT: port, OMP_STATE_DIR: state },
  });
  server.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  async function ready(attempt: number): Promise<void> {
    if (server?.exitCode !== null) throw new Error("Dev server exited:\n" + output);

    try {
      const health = await fetch(base + "/health", { signal: AbortSignal.timeout(1000) });

      if (health.ok) return;
    } catch {
      /* Startup may take several seconds on a fresh machine. */
    }

    if (attempt >= 120) throw new Error("Dev server did not start:\n" + output);
    await pause(500);

    return ready(attempt + 1);
  }

  await ready(0);
}

async function stop() {
  const child = server;

  if (child?.pid === undefined) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  process.kill(-child.pid, "SIGTERM");
  await exited;
  server = undefined;
  await pause(200);
}

try {
  await start(join(temporary, "first"));
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(base + "/stores/personal/fmp/read_inferences")).status, 401);
  assert.equal((await fetch(base + "/mcp")).status, 401);

  const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
  assert.equal(
    (await fetch(base + "/stores/personal/fmp/import", { method: "POST", headers, body: "{" }))
      .status,
    400,
  );
  assert.equal(
    (
      await fetch(base + "/stores/personal/fmp/import", {
        method: "POST",
        headers: { ...headers, "content-type": "text/application/json" },
        body: "{}",
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await fetch(base + "/stores/personal/fmp/import", {
        method: "POST",
        headers,
        body: JSON.stringify({ oversized: "x".repeat(1048576) }),
      })
    ).status,
    413,
  );

  const saved = await client.remember({
    identifier: "restart-canary",
    body: "Survives a process restart",
    custom: { nested: [1, true, null] },
    links: [{ target: "restart-canary", rel: "self" }],
  });

  const origin = saved.memory.x_omp_origin;
  const snapshot = await client.export();
  const archiveFile = join(temporary, "snapshot.json");
  await writeFile(archiveFile, JSON.stringify(snapshot));
  await run("python3", [
    "examples/file-store.py",
    "import",
    archiveFile,
    join(temporary, "folder"),
  ]);
  await run("python3", [
    "examples/file-store.py",
    "export",
    join(temporary, "folder"),
    join(temporary, "returned.json"),
  ]);
  assert.deepEqual(
    JSON.parse(await readFile(join(temporary, "returned.json"), "utf8")),
    JSON.parse(JSON.stringify(snapshot)),
  );
  await stop();
  await start(join(temporary, "first"));
  assert.deepEqual((await client.read("restart-canary")).memory, saved.memory);
  assert.equal((await client.import(snapshot)).receipts[0]?.status, "unchanged");
  await client.delete("restart-canary");

  const env = { ...process.env, OMP_API_TOKEN: token };
  await run("npm", ["run", "roundtrip", "--", base], env);
  await run("npm", ["run", "mcp:roundtrip", "--", base], env);
  await run("npm", ["run", "regression:roundtrip", "--", base], env);
  await run("npm", ["run", "concurrency:roundtrip", "--", base], env);
  const fullSnapshot = await client.snapshot();
  assert.ok(fullSnapshot.tombstones.length >= 51);
  await stop();
  await start(join(temporary, "second"));

  const independent = await client.remember({
    identifier: "independent",
    body: "Separate deployment",
  });

  assert.notEqual(independent.memory.x_omp_origin, origin);
  assert.equal((await client.import(snapshot)).receipts[0]?.status, "accepted");
  assert.deepEqual((await client.read("restart-canary")).memory, saved.memory);
  await client.importSnapshot(fullSnapshot);
  await assert.rejects(
    () => client.read("restart-canary"),
    (error: Error) => error instanceof ApiError && error.status === 404,
  );
  console.log("PASS bounded request validation and full SDK multi-page snapshots");
  console.log(
    "PASS authentication, public UI, process restart, separate origins, independent Python file-store exchange, HTTP, MCP, concurrency and regression suites",
  );
} finally {
  await stop();
  await rm(temporary, { recursive: true, force: true });
}
