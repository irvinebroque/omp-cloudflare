import { validateMemory } from "../src/model.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  addContribution,
  applicable,
  memoryVersion,
  repositoryKey,
  validateContext,
  validateConventions,
} from "../src/runtime.ts";
import type { Memory } from "../src/model.ts";

const memory: Memory = {
  identifier: "x",
  media_type: "text/markdown",
  created_at: "2026-11-06T00:00:00Z",
  body: "Use pnpm",
};

const repo = "https://github.com/acme/web";

test("repository rules never become global and git remote syntaxes normalize", () => {
  const m = { ...memory, applies_to: { level: "repository", repository: repo } };
  assert.equal(repositoryKey("git@github.com:acme/web.git"), repositoryKey(repo));
  assert.equal(applicable(m, {}), false);
  assert.equal(applicable(m, { repository: "https://github.com/acme/other" }), false);
  assert.equal(applicable(m, { repository: "git@github.com:acme/web.git" }), true);
});

test("directory applicability respects boundaries and matching task files", () => {
  const m = { ...memory, applies_to: { level: "directory", repository: repo, directory: "src" } };
  assert.equal(applicable(m, { repository: repo, directory: "src/ui" }), true);
  assert.equal(applicable(m, { repository: repo, directory: "src-other" }), false);
  assert.equal(applicable(m, { repository: repo, directory: ".", paths: ["src/index.ts"] }), true);
});

test("glob activation and applicability both need a matching relative path", () => {
  const m = {
    ...memory,
    applies_to: { level: "paths", repository: repo, globs: ["src/**"] },
    activation: { mode: "paths", globs: ["**/*.ts"] },
  };

  assert.equal(applicable(m, { repository: repo, paths: ["src/app.ts"] }), true);
  assert.equal(applicable(m, { repository: repo, paths: ["test/app.ts"] }), false);
  assert.equal(applicable(m, { repository: repo, paths: ["src/app.js"] }), false);
  assert.equal(applicable(m, { repository: repo }), false);
});

test("on-request memories stay out of ordinary reads", () => {
  const m = { ...memory, activation: { mode: "on_request" } };
  assert.equal(applicable(m, {}), false);
  assert.equal(applicable(m, { explicit_request: true }), true);
});

test("runtime direct reads exclude future and expired records", () => {
  assert.equal(applicable({ ...memory, valid_until: "2020-01-01T00:00:00Z" }, {}), false);
  assert.equal(applicable({ ...memory, valid_from: "2099-01-01T00:00:00Z" }, {}), false);
});

test("unknown imported conventions are excluded, while legacy unscoped memories remain usable", () => {
  assert.equal(applicable({ ...memory, applies_to: { level: "unknown-future-level" } }, {}), false);
  assert.equal(applicable({ ...memory, activation: { mode: "unknown-future-mode" } }, {}), false);
  assert.equal(applicable(memory, {}), true);
  assert.throws(() => {
    validateConventions({ ...memory, activation: { mode: "relevant" } });
  });
});

test("absolute and parent paths cannot masquerade as repository-relative paths", () => {
  for (const path of ["/src/a", "../a", "src/../../a", "C:\\a"])
    assert.throws(() => validateContext({ paths: [path] }));
  assert.throws(() => validateContext({ repository: "file:///local/repo" }));
  assert.throws(() => validateContext({ explicit_request: "false" }));
});

test("version tokens track the individual memory and extension fields, independent of property order", () => {
  assert.equal(memoryVersion(memory), memoryVersion({ ...memory }));
  assert.equal(
    memoryVersion(memory),
    memoryVersion({
      body: memory.body,
      created_at: memory.created_at,
      media_type: memory.media_type,
      identifier: memory.identifier,
    }),
  );
  assert.notEqual(memoryVersion(memory), memoryVersion({ ...memory, body: "Use npm" }));
  assert.notEqual(
    memoryVersion(memory),
    memoryVersion({ ...memory, custom: { owner: "changed" } }),
  );
});

test("unsupported imported provenance cannot be silently overwritten", () => {
  const original = validateMemory({
    identifier: "legacy",
    media_type: "text/plain",
    created_at: "2026-11-06T00:00:00Z",
    body: "Evidence",
    provenance: { source: "legacy evidence" },
  });

  assert.throws(
    () => addContribution(original, "agent:codex", "updated"),
    /Unsupported provenance/u,
  );
  assert.deepEqual(original.provenance, { source: "legacy evidence" });
});

test("paged recall evaluates applicability at the frozen search time", () => {
  const expiring = { ...memory, valid_until: "2026-01-02T00:00:00Z" };
  assert.equal(applicable(expiring, {}, Date.parse("2026-01-01T00:00:00Z")), true);
  assert.equal(applicable(expiring, {}, Date.parse("2026-01-03T00:00:00Z")), false);
});
