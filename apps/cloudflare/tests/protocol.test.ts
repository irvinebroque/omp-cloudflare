import { describe, expect, it } from "vite-plus/test";
import {
  archive,
  archiveSchema,
  importedMemories,
  memorySchema,
  merge,
  stable,
  type State,
} from "../src/protocol/model.ts";
import { memoryVersion } from "../src/protocol/runtime.ts";
import { applicable, repositoryKey, relativePath } from "@omp-cloudflare/sdk/experimental";
import { authorize } from "../src/server/auth.ts";

it("fails closed for an absent secret or the former example placeholder", () => {
  const request = new Request("https://example.invalid");
  expect(() => authorize(request, undefined)).toThrow("Configure MEMORY_API_TOKEN");
  expect(() =>
    authorize(request, "replace-with-a-random-private-token-of-at-least-24-characters"),
  ).toThrow("Configure MEMORY_API_TOKEN");
});

const memory = memorySchema.parse({
  identifier: "preferences",
  created_at: "2026-11-08T12:00:00Z",
  media_type: "text/markdown",
  body: "Prefer working code.",
  links: [{ target: "project", rel: "relates_to", extension: 7 }],
  custom: { nested: [42, true, null] },
  protocol_version: "0.5",
  weight: -12.5,
});

function store(): State {
  return { origin: "example:one", memories: [], tombstones: [] };
}

describe("portable minimal memories", () => {
  it("preserves unknown JSON fields through parse, archive, and import", () => {
    const state = store();
    merge(state, [memory]);
    const snapshot = archiveSchema.parse(JSON.parse(JSON.stringify(archive(state))));
    expect(snapshot.manifest.protocol_version).toBe("0.5");
    expect(snapshot.memories[0]?.identifier).toBe("preferences");
    expect(importedMemories(snapshot)).toEqual(state.memories);
  });

  it("keeps typed edges usable for generic receivers when identifiers collide", () => {
    const state = store();
    merge(state, [
      memory,
      { ...memory, identifier: "project", body: "First project" },
      { ...memory, identifier: "project", x_omp_origin: "example:two", body: "Other project" },
    ]);
    const snapshot = archive(state);
    const root = snapshot.memories.find((item) => item.identifier === "preferences");
    const project = snapshot.memories.find((item) => item.body === "First project");
    expect(root?.links).toEqual([{ target: project?.identifier, rel: "relates_to", extension: 7 }]);
    expect(new Set(snapshot.memories.map((item) => item.identifier)).size).toBe(3);
    expect(importedMemories(snapshot)).toEqual(state.memories);
  });

  it("accepts legacy 0.2 archives, rejects unknown future transaction versions", () => {
    const snapshot = archive(store());
    expect(
      archiveSchema.safeParse({
        ...snapshot,
        manifest: { ...snapshot.manifest, protocol_version: "0.2" },
      }).success,
    ).toBe(true);
    expect(
      archiveSchema.safeParse({
        ...snapshot,
        manifest: { ...snapshot.manifest, protocol_version: "99" },
      }).success,
    ).toBe(false);
  });

  it("makes repeated imports idempotent and rejects conflicting content", () => {
    const state = store();
    expect(merge(state, [memory])[0]?.status).toBe("accepted");
    expect(merge(state, [memory])[0]?.status).toBe("unchanged");
    expect(merge(state, [{ ...memory, body: "Changed" }])[0]?.status).toBe("rejected");
    expect(state.memories[0]?.body).toBe(memory.body);
  });

  it("blocks stale replay after deletion", () => {
    const state = store();
    merge(state, [memory]);
    merge(
      state,
      [],
      [{ origin: state.origin, identifier: memory.identifier, deleted_at: "2026-11-08T13:00:00Z" }],
    );
    expect(merge(state, [memory])[0]?.reason).toBe("deleted_identity");
    expect(state.memories).toEqual([]);
  });

  it("rejects malformed MIME types, oversized UTF-8 bodies and invalid validity ranges", () => {
    for (const patch of [
      { media_type: "markdown" },
      { body: "🧠".repeat(4097) },
      { valid_from: "2026-11-09T00:00:00Z", valid_until: "2026-11-08T00:00:00Z" },
    ]) {
      expect(memorySchema.safeParse({ ...memory, ...patch }).success).toBe(false);
    }

    expect(
      memorySchema.safeParse({ ...memory, media_type: "text/plain; charset=utf-8" }).success,
    ).toBe(true);
  });

  it("rejects corrupt identity mappings before mutating a receiver", () => {
    const state = store();
    merge(state, [memory]);
    const snapshot = archive(state);
    snapshot.manifest.x_omp_identity_map = [];
    expect(() => importedMemories(snapshot)).toThrow("Invalid export identity mapping");
  });

  it("hashes canonical content rather than object insertion order", () => {
    expect(stable({ a: 1, b: 2 })).toBe(stable({ b: 2, a: 1 }));
    expect(memoryVersion(memory)).not.toBe(memoryVersion({ ...memory, body: "Edited" }));
  });
});

describe("runtime conventions", () => {
  it("matches repository scope across SSH and HTTPS remote syntax", () => {
    const scoped = {
      ...memory,
      applies_to: { level: "repository", repository: "git@github.com:example/project.git" },
    };

    expect(repositoryKey("git@github.com:example/project.git")).toBe("github.com/example/project");
    expect(applicable(scoped, { repository: "https://github.com/example/project" })).toBe(true);
    expect(applicable(scoped, { repository: "https://github.com/other/project" })).toBe(false);
    expect(applicable(scoped, {})).toBe(false);
  });

  it("fails closed for unknown imported scopes and requires explicit on-request retrieval", () => {
    expect(applicable({ ...memory, applies_to: { level: "future" } }, {})).toBe(false);
    const requested = { ...memory, activation: { mode: "on_request" } };
    expect(applicable(requested, {})).toBe(false);
    expect(applicable(requested, { explicit_request: true })).toBe(true);
  });

  it("rejects absolute and escaping repository paths", () => {
    expect(() => relativePath("../secrets")).toThrow();
    expect(() => relativePath("/Users/private")).toThrow();
    expect(relativePath("./src/main.ts")).toBe("src/main.ts");
  });
});

describe("operator authentication", () => {
  const token = "a-private-test-token-with-enough-entropy";
  it("accepts the configured bearer and rejects absent or different credentials", () => {
    expect(() =>
      authorize(
        new Request("https://example.test", { headers: { authorization: "Bearer " + token } }),
        token,
      ),
    ).not.toThrow();
    expect(() => authorize(new Request("https://example.test"), token)).toThrow();
    expect(() =>
      authorize(
        new Request("https://example.test", { headers: { authorization: "Bearer wrong" } }),
        token,
      ),
    ).toThrow();
  });

  it("fails closed when an operator forgot to configure a strong-enough token", () => {
    expect(() => authorize(new Request("https://example.test"), "short")).toThrow("Configure");
  });
});
