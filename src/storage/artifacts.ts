import { clone, init, resolveRef, add, commit as gitCommit, push } from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { createFsFromVolume, Volume } from "memfs";
import { ApiError, stable, stateSchema, text, type State } from "../protocol/model.ts";

export const STORES = ["personal", "company"] as const;

export type Store = (typeof STORES)[number];

const FILE = "omp-state.json";

const empty = (id: string): State => ({
  origin: "cloudflare-artifacts:" + id,
  memories: [],
  tombstones: [],
});

/** Artifacts assigns each repo a stable ID, including in the local simulator. */
async function repository(artifacts: Artifacts, store: Store): Promise<ArtifactsRepo> {
  try {
    return await artifacts.get(store);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "NOT_FOUND") throw error;
  }

  try {
    const created = await artifacts.create(store, { setDefaultBranch: "main" });
    using repo = await artifacts.get(store);
    await repo.revokeToken(created.token);
  } catch (error) {
    // Two first requests may race to initialize the same repository.
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ALREADY_EXISTS")
      throw error;
  }

  return artifacts.get(store);
}

export async function read(
  artifacts: Artifacts,
  store: Store,
): Promise<{ state: State; commit: string | null }> {
  using repo = await repository(artifacts, store);
  const history = await repo.log({ ref: "main", limit: 1 });
  const commit = history[0]?.hash ?? null;

  if (commit === null) return { state: empty((await repo.info()).id), commit: null };
  const blob = await repo.readFile({ ref: commit, path: FILE });

  if (blob === null) throw new Error("Artifact state file missing");

  return { state: stateSchema.parse(JSON.parse(await blob.text())), commit };
}

/** Git's non-fast-forward rejection is the concurrency guard. Never force push. */
export async function mutate<T>(
  artifacts: Artifacts,
  store: Store,
  message: string,
  apply: (state: State) => T,
): Promise<{ result: T; commit: string }> {
  using repo = await repository(artifacts, store);
  const info = await repo.info();
  const token = await repo.createToken("write", 300);

  const onAuth = () => ({
    username: "x",
    password: text(token.plaintext.split("?expires=").at(0), "Artifact write token", 8192),
  });

  try {
    async function attemptWrite(attempt: number): Promise<{ result: T; commit: string }> {
      const fs = createFsFromVolume(new Volume());
      const dir = "/memory";
      const history = await repo.log({ ref: "main", limit: 1 });

      if (history.length > 0)
        await clone({
          fs,
          http,
          dir,
          url: info.remote,
          ref: "main",
          singleBranch: true,
          depth: 1,
          onAuth,
        });
      else await init({ fs, dir, defaultBranch: "main" });

      const state =
        history.length > 0
          ? stateSchema.parse(
              JSON.parse(String(await fs.promises.readFile(`${dir}/${FILE}`, "utf8"))),
            )
          : empty(info.id);

      const before = stable(state);
      const result = apply(state);

      if (before === stable(state) && history.length > 0)
        return { result, commit: await resolveRef({ fs, dir, ref: "HEAD" }) };
      await fs.promises.writeFile(`${dir}/${FILE}`, JSON.stringify(state, null, 2) + "\n");
      await fs.promises.writeFile(
        `${dir}/MEMORY.md`,
        "# OMP memory\n\n" +
          state.memories.map((m) => `- ${m.identifier}: ${m.title ?? "(untitled)"}`).join("\n") +
          "\n\nFull objects and extension fields are in omp-state.json.\n",
      );
      await add({ fs, dir, filepath: FILE });
      await add({ fs, dir, filepath: "MEMORY.md" });

      const commit = await gitCommit({
        fs,
        dir,
        message,
        author: { name: "OMP Cloudflare prototype", email: "omp@example.invalid" },
      });

      try {
        const pushed = await push({ fs, http, dir, url: info.remote, ref: "main", onAuth });

        if (
          !pushed.ok ||
          pushed.error !== undefined ||
          Object.values(pushed.refs).some((r) => !r.ok)
        )
          throw new ApiError(409, "Artifact push was rejected");

        return { result, commit };
      } catch (error) {
        // A simultaneous writer may have advanced main. Re-clone and reapply to its state.
        const latest = await repo.log({ ref: "main", limit: 1 });

        if (attempt === 3 || latest[0]?.hash === history[0]?.hash) throw error;

        return attemptWrite(attempt + 1);
      }
    }

    return await attemptWrite(0);
  } finally {
    await revokeWriteToken(() => repo.revokeToken(token.plaintext));
  }
}

/** Token TTL bounds a cleanup failure; cleanup must not replace a committed result or primary error. */
export async function revokeWriteToken(revoke: () => Promise<boolean>) {
  try {
    await revoke();
  } catch {
    console.error("Artifact write token cleanup failed; token expires after 300 seconds");
  }
}
