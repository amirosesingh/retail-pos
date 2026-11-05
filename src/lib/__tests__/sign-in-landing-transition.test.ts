import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { signInDestination } from "../sign-in-destination";

const source = readFileSync("src/platforms/web/components/pos/AppShell.tsx", "utf8").replaceAll("\r\n", "\n");
const marker = "  useEffect(() => {\n    if (!ready) return;";
const effectStart = source.indexOf(marker, source.indexOf("const sawSignedOut"));
if (effectStart < 0) throw new Error("Sign-in landing effect not found");
const effectEnd = source.indexOf("  }, [ready, user", effectStart);
if (effectEnd < 0) throw new Error("Sign-in landing effect boundary not found");
const effectBody = source.slice(effectStart + "  useEffect(() => {".length, effectEnd);

function fixture() {
  const context = {
    ready: false, user: null as null | { email: string; staffId: string; name: string },
    terminalUser: null as null | { userCode: string }, authUserId: null as string | null,
    handledIdentity: { current: null as string | null }, sawSignedOut: { current: false },
    isAdmin: true, can: () => true, visibleRoute: () => true,
    // No window/storage: absence of a per-tab landing marker must not change
    // the verified current page or require another network/authentication call.
    signInDestination, navigate: vi.fn(),
  };
  return { context, step: () => runInNewContext(`(function(){${effectBody}})()`, context) };
}
const user = { email: "human@example.invalid", staffId: "person-a", name: "Human" };

describe("default landing follows real operator sign-in", () => {
  it("keeps a restored verified session on its deep link when the old per-tab marker is absent", () => {
    const { context, step } = fixture();
    // Auth remains unready while its restored session/profile is verified.
    step();
    context.ready = true; context.user = user; context.authUserId = "auth-a";
    step();
    expect(context.navigate).not.toHaveBeenCalled();
  });

  it.each(["password", "PIN"])("applies the configured default exactly once after interactive %s sign-in", method => {
    const { context, step } = fixture();
    context.ready = true; step(); // The actual AppShell-owned login form is visible.
    context.user = user;
    if (method === "PIN") { context.terminalUser = { userCode: "person-a" }; context.isAdmin = false; }
    else context.authUserId = "auth-a";
    step(); step();
    expect(context.navigate).toHaveBeenCalledExactlyOnceWith({ to: method === "PIN" ? "/" : "/dashboard", search: {}, replace: true });
  });

  it("does not redirect on profile/permission refresh or repeated same-user auth publication", () => {
    const { context, step } = fixture();
    context.ready = true; context.user = user; context.authUserId = "auth-a"; step();
    context.user = { ...user, name: "Updated name" }; context.can = () => false; step();
    expect(context.navigate).not.toHaveBeenCalled();
  });

  it("keeps the real logout/relogin transition even for the same account", () => {
    const { context, step } = fixture();
    context.ready = true; context.user = user; context.authUserId = "auth-a"; step();
    context.user = null; context.authUserId = null; step();
    context.user = user; context.authUserId = "auth-a"; step(); step();
    expect(context.navigate).toHaveBeenCalledOnce();
  });
});
