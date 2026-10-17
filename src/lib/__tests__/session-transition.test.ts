import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createSessionTransition } from "../session-transition";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("switching users during sign-out", () => {
  it.each(["password", "PIN"])("holds a new %s login until old remote sign-out finishes", async () => {
    const transition = createSessionTransition();
    const remote = deferred();
    let token: string | null = "old-user";
    const ending = transition.end(async () => {
      token = null; // The login form is now visible.
      await remote.promise;
      token = null; // Late Auth signOut must precede the new login.
    });
    await Promise.resolve();
    let signedIn = false;
    const login = (async () => {
      await transition.wait();
      token = "new-user";
      signedIn = true;
    })();
    await Promise.resolve();
    expect(signedIn).toBe(false);
    remote.resolve();
    await Promise.all([ending, login]);
    expect(token).toBe("new-user");
  });

  it("coalesces concurrent logout/expiry cleanup instead of racing two sign-outs", async () => {
    const transition = createSessionTransition();
    const remote = deferred();
    let cleanups = 0;
    const first = transition.end(async () => { cleanups++; await remote.promise; });
    const second = transition.end(async () => { cleanups++; });
    expect(second).toBe(first);
    remote.resolve();
    await first;
    expect(cleanups).toBe(1);
    await transition.end(async () => { cleanups++; });
    expect(cleanups).toBe(2);
  });

  it("releases the barrier after failed cleanup without an unhandled rejection", async () => {
    const transition = createSessionTransition();
    const ending = transition.end(async () => { throw new Error("cleanup failed"); });
    await expect(ending).rejects.toThrow("cleanup failed");
    await expect(transition.wait()).resolves.toBeUndefined();
  });

  it("allows fresh and offline login immediately when no teardown is pending", async () => {
    await expect(createSessionTransition().wait()).resolves.toBeUndefined();
  });

  it("wires both shared login methods behind the same teardown", () => {
    const source = readFileSync("src/lib/pos-auth.tsx", "utf8");
    expect(source.match(/await sessionTransition\.wait\(\)/g)).toHaveLength(2);
    expect(source).toContain("sessionTransition.end(() => finishSession(reason, startedAt))");
  });
});
