import { AsyncLocalStorage } from "node:async_hooks";

const scopes = new AsyncLocalStorage<Map<string, Promise<void>>>();

/** Git's filesystem is request-local; its path locks must have the same lifetime. */
export function withGitLockScope<T>(operation: () => Promise<T>): Promise<T> {
  return scopes.run(new Map(), operation);
}

/** The promise-mode acquire contract used by pinned isomorphic-git 1.44.11. */
export default class GitLock {
  async acquire<T>(keys: string | string[], operation: () => T | Promise<T>): Promise<T> {
    if (Array.isArray(keys)) {
      const [first, ...remaining] = keys;

      return first === undefined
        ? operation()
        : this.acquire(first, () => this.acquire(remaining, operation));
    }

    const locks = scopes.getStore();

    if (locks === undefined) throw new Error("Git operations require a request-local lock scope");
    const previous = locks.get(keys) ?? Promise.resolve();
    const { promise: current, resolve: release } = Promise.withResolvers<void>();
    const queued = previous.then(() => current);
    locks.set(keys, queued);
    await previous;

    try {
      return await operation();
    } finally {
      release();

      if (locks.get(keys) === queued) locks.delete(keys);
    }
  }
}
