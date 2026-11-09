import { project } from "./project-settings.ts";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function cf(args: string[], capture = false) {
  const result = spawnSync("cf", args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });

  if (result.error !== undefined) throw result.error;

  return result;
}

const namespace = process.env.OMP_NAMESPACE ?? project.name;
const existing = cf(["artifacts", "namespaces", "get", namespace], true);

if (existing.status !== 0) {
  const diagnostic = existing.stdout + existing.stderr;

  if (!/NOT_FOUND|not found|404/iu.test(diagnostic))
    throw new Error(
      "Cannot inspect the Artifacts namespace. Check cf login, the selected account, and Artifacts permissions.\n" +
        diagnostic,
    );
  const created = cf(["artifacts", "namespaces", "create", "--namespace", namespace]);

  if (created.status !== 0)
    throw new Error(
      "Cannot create the Artifacts namespace. Workers Paid and Artifacts write permission are required.",
    );
}

const token = process.env.MEMORY_API_TOKEN;
const temporary = await mkdtemp(join(tmpdir(), "omp-deploy-"));

try {
  const args = ["deploy"];

  if (token !== undefined) {
    if (token.length < 24) throw new Error("MEMORY_API_TOKEN must be at least 24 characters.");
    const file = join(temporary, "secrets.json");
    await writeFile(file, JSON.stringify({ MEMORY_API_TOKEN: token }), { mode: 0o600 });
    args.push("--secrets-file", file);
  }

  const result = cf(args);
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
