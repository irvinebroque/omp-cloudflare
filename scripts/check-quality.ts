import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";

// Keep fixtures inside the checked project so the real registered plugin and TS config apply.
const file = "tests/quality-fixture.ts";

try {
  await writeFile(
    file,
    'export const names = ["Ada", "Grace"].flatMap((name) => name.length > 3 ? [name.toUpperCase()] : []);\n',
  );
  const valid = spawnSync("vp", ["lint", file, "--deny-warnings"], { encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  await writeFile(
    file,
    'export const names = ["Ada", "Grace"].filter((name) => name.length > 3).map((name) => name.toUpperCase());\n',
  );
  const invalid = spawnSync("vp", ["lint", file, "--deny-warnings"], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout + invalid.stderr, /anti-slop\(no-array-filter-map\)/u);
  console.log(
    "PASS registered anti-slop plugin accepts the single-pass fixture and rejects filter/map",
  );
} finally {
  await unlink(file);
}
