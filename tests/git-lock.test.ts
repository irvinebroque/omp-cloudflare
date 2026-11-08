import { expect, it } from "vite-plus/test";
import GitLock, { withGitLockScope } from "../src/storage/git-lock.ts";

it("serializes one request's work and releases a failed operation", async () => {
  const lock = new GitLock();
  const order: string[] = [];
  await withGitLockScope(async () => {
    const failed = lock.acquire("HEAD", async () => {
      order.push("first");
      await Promise.resolve();
      throw new Error("failed write");
    });

    const next = lock.acquire("HEAD", () => order.push("second"));
    await expect(failed).rejects.toThrow("failed write");
    await next;
  });
  expect(order).toEqual(["first", "second"]);
});

it("never queues another request behind a held lock with the same path", async () => {
  const lock = new GitLock();
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  const first = withGitLockScope(() => lock.acquire("packed-refs", () => held));
  await withGitLockScope(async () => {
    expect(await lock.acquire("packed-refs", () => "independent")).toBe("independent");
  });
  release();
  await first;
});

it("fails closed outside a request scope and supports ordered batch keys", async () => {
  const lock = new GitLock();
  await expect(lock.acquire("HEAD", () => "unsafe")).rejects.toThrow("request-local lock scope");
  expect(await withGitLockScope(() => lock.acquire(["HEAD", "index"], () => "done"))).toBe("done");
});
