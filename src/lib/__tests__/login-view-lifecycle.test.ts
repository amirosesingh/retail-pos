import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createLoginView } from "../login-view";

type Element = { type: unknown; props: Record<string, unknown> };
type Hooks = { slots: unknown[]; cursor: number; effectCursor: number; deps: Array<readonly unknown[] | undefined>; cleanups: Array<undefined | (() => void)>; pending: Array<() => void> };
const freshHooks = (): Hooks => ({ slots: [], cursor: 0, effectCursor: 0, deps: [], cleanups: [], pending: [] });
const source = (path: string) => ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = Object.fromEntries([
  "src/lib/internal-domains.ts", "src/lib/login-failure.ts", "src/core/activation/registration-status.ts",
  "src/platforms/web/components/pos/TerminalLogin.tsx", "src/platforms/web/components/pos/AppShell.tsx",
].map(path => [path, source(path)]));

/** Executes the actual components and hook effects; unrelated shell services are inert. */
function fixture(platform: "android" | "ios" | "electron" | "web" = "android") {
  let active = freshHooks();
  const shellHooks = freshHooks();
  const state = { verdict: "verified", ready: true, user: null as null | { staffId: string }, username: "administrator@example.test", password: "fixture-password", nativePasswordManager: false };
  const login = vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ ok: false, code: "permission-denied", error: "Account cannot access this branch" });
  const offerSaveLogin = vi.fn(async () => {});
  const modules = new Map<string, Record<string, unknown>>();
  const generic = () => new Proxy<Record<string, unknown>>({}, { get: (target, name: string) => target[name] ??= () => undefined });
  const react = {
    useState(initial: unknown) {
      const owner = active, index = owner.cursor++;
      if (!(index in owner.slots)) owner.slots[index] = typeof initial === "function" ? initial() : initial;
      return [owner.slots[index], (next: unknown) => { owner.slots[index] = typeof next === "function" ? next(owner.slots[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = active.cursor++;
      if (!(index in active.slots)) active.slots[index] = { current: initial };
      return active.slots[index];
    },
    useEffect(effect: () => undefined | (() => void), deps?: readonly unknown[]) {
      const owner = active, index = owner.effectCursor++, previous = owner.deps[index];
      if (index in owner.deps && deps && previous && deps.every((value, i) => Object.is(value, previous[i]))) return;
      owner.deps[index] = deps;
      owner.pending.push(() => { owner.cleanups[index]?.(); owner.cleanups[index] = effect(); });
    },
    useCallback: (callback: unknown) => callback, useContext: () => false,
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props: props ?? {} });
  const registry: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" }, "@/lib/login-view": { createLoginView },
    "@/platform-config/platform": { isNative: () => platform === "android" || platform === "ios", isTerminalApp: () => platform !== "web" },
    "@/lib/branding": { useBranding: () => ({ company: "Fixture" }), isDesktop: () => platform === "electron" },
    "@/platform-config/password-manager": { get hasNativePasswordManager() { return state.nativePasswordManager; }, offerSaveLogin, requestSavedLogin: async () => null },
    "@/lib/pos-auth": { useAuth: () => ({ ready: state.ready, user: state.user, isAdmin: false, canSwitchStores: false, terminalStoreId: "a", authUserId: state.user ? "verified-person" : null, can: () => false, login }) },
    "@/lib/pos-store": { usePos: () => ({ stores: [], currentStore: { id: "a" }, setCurrentStore: () => {}, state: { settings: { integrations: { receiptPrinter: {} }, receipt: {}, tax: {} } }, ready: true }) },
    "@/lib/use-local-startup": { useLocalStartupReady: () => false }, "@/hooks/use-mobile": { useIsMobile: () => true },
    "@/lib/use-revocation-check": { useRevocationCheck: () => ({ config: { tokenId: "terminal", locationId: "a" }, hydrating: false, verified: true, revoked: false }) },
    "@/lib/connection-profile": { isConnectionProfileHydrated: () => true, hydrateConnectionProfile: async () => {} },
    "@/lib/personal-appearance": { usePersonalAppearance: () => ({ key: "fixture", owner: "fixture", profile: {} }), usePersonalAppearanceSync: () => {} },
    "@/lib/ui-visibility": { useVisibility: () => ({ visibleRoute: () => true }) },
    "@/platforms/web/components/pos/settings/use-settings-nav": { useSettingsNav: () => ({ cards: [] }) },
    "@/platforms/web/components/pos/SidebarNav": { useSidebarCollapsed: () => [false, () => {}] },
    "@/platform-config/features": { hasFeature: () => false }, "@/lib/management-device": { isManagementDevice: () => false },
    "@tanstack/react-router": { useLocation: () => ({ pathname: "/" }), useNavigate: () => () => {}, Link: () => undefined },
    "@/lib/whatsapp": { flushWhatsAppQueue: async () => {} },
    "@/core/types/pos-types": { bookingRulesOf: () => ({}) },
  };
  const load = (path: string): Record<string, (props?: Record<string, unknown>) => Element> => {
    const module = { exports: {} };
    runInNewContext(compiled[path], {
      module, exports: module.exports,
      require: (id: string) => { if (registry[id]) return registry[id]; if (!modules.has(id)) modules.set(id, generic()); return modules.get(id); },
      FormData: class { get(name: string) { return name === "username" ? state.username : state.password; } },
      window: { location: { pathname: "/" }, addEventListener() {}, removeEventListener() {} },
      document: { documentElement: { lang: "en" } },
    }, { filename: path });
    return module.exports;
  };
  registry["@/lib/internal-domains"] = load("src/lib/internal-domains.ts");
  registry["@/lib/login-failure"] = load("src/lib/login-failure.ts");
  const status = load("src/core/activation/registration-status.ts");
  registry["@/core/activation/registration-status"] = { ...status, useStartupGate: () => ({ registration: "registered", loading: false, probing: false, verdict: state.verdict, cloudConfigured: true, offlineAvailable: false }) };
  const { TerminalLogin } = load("src/platforms/web/components/pos/TerminalLogin.tsx");
  registry["@/platforms/web/components/pos/TerminalLogin"] = { TerminalLogin };
  const { AppShell } = load("src/platforms/web/components/pos/AppShell.tsx");
  function render(component: (props: Record<string, unknown>) => Element, props: Record<string, unknown>, owner: Hooks) {
    active = owner; owner.cursor = 0; owner.effectCursor = 0;
    const result = component(props); owner.pending.splice(0).forEach(effect => effect()); return result;
  }
  const find = (node: unknown, predicate: (element: Element) => boolean): Element | undefined => {
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const element = node as Element; if (predicate(element)) return element;
    for (const child of [element.props.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
  };
  function shell() { const frame = render(AppShell, { children: null }, freshHooks()); return render(frame.type as typeof AppShell, frame.props, shellHooks); }
  function panel(owner = freshHooks(), settle = true) {
    const node = find(shell(), element => element.type === TerminalLogin); expect(node).toBeDefined();
    let tree = render(TerminalLogin, node!.props, owner);
    if (settle) for (let i = 0; i < 3; i++) tree = render(TerminalLogin, node!.props, owner);
    return { owner, tree };
  }
  function standalone(owner = freshHooks(), settle = true) {
    let tree = render(TerminalLogin, {}, owner);
    if (settle) for (let i = 0; i < 3; i++) tree = render(TerminalLogin, {}, owner);
    return { owner, tree };
  }
  const mode = (tree: Element) => find(tree, element => element.type === modules.get("@/components/ui/tabs")?.Tabs)!.props.value;
  const choose = (tree: Element, next: string) => (find(tree, element => element.type === modules.get("@/components/ui/tabs")?.Tabs)!.props.onValueChange as (value: string) => void)(next);
  const submit = (tree: Element) => (find(tree, element => element.type === "form")!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {}, currentTarget: {} });
  const error = (tree: Element, text: string) => Boolean(find(tree, element => element.type === "p" && element.props.children === text));
  const submitDisabled = (tree: Element) => find(tree, element => element.props.type === "submit")!.props.disabled;
  const recoveryLink = (tree: Element) => find(tree, element => element.props.to === "/recovery");
  const unmount = (owner: Hooks) => owner.cleanups.forEach(cleanup => cleanup?.());
  const deferred = () => { let resolve!: (value: unknown) => void, reject!: (error: Error) => void; const result = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); login.mockImplementationOnce(() => result); return { resolve, reject }; };
  return { state, login, offerSaveLogin, modules, shell, panel, standalone, mode, choose, submit, error, submitDisabled, recoveryLink, unmount, deferred };
}

describe("password sign-in presentation survives the existing shell gates", () => {
  it.each(["before", "during"])("keeps a real refusal arriving %s an Android connection outage", async timing => {
    const f = fixture(), request = f.deferred();
    let panel = f.panel(); f.choose(panel.tree, "admin"); panel = f.panel(panel.owner);
    const pending = f.submit(panel.tree);
    if (timing === "before") { request.resolve({ ok: false, code: "permission-denied", error: "Branch access denied" }); await pending; }
    f.state.verdict = "unreachable";
    expect(f.shell().type).toBe(f.modules.get("@/platforms/mobile/components/OfflineGate")!.OfflineStatus);
    f.unmount(panel.owner);
    if (timing === "during") { request.resolve({ ok: false, code: "permission-denied", error: "Branch access denied" }); await pending; }
    f.state.verdict = "verified"; const recovered = f.panel();
    expect(f.mode(recovered.tree)).toBe("admin"); expect(f.error(recovered.tree, "Branch access denied")).toBe(true);
    expect(f.login).toHaveBeenCalledExactlyOnceWith("administrator@example.test", "fixture-password");
  });
  it.each(["android", "ios", "electron"] as const)("retains the first password request before platform detection and blocks a duplicate after %s remount", async platform => {
    const f = fixture(platform), request = f.deferred(), first = f.panel(undefined, false);
    expect(f.mode(first.tree)).toBe("admin"); const pending = f.submit(first.tree);
    f.state.ready = false; f.shell(); f.unmount(first.owner);
    f.state.ready = true; let recovered = f.panel(); expect(f.mode(recovered.tree)).toBe("admin");
    expect(f.submitDisabled(recovered.tree)).toBe(true);
    f.choose(recovered.tree, "cashier"); expect(f.mode(f.panel(recovered.owner).tree)).toBe("admin");
    await f.submit(recovered.tree); expect(f.login).toHaveBeenCalledOnce();
    request.reject(new Error("Network timeout")); await pending;
    recovered = f.panel(recovered.owner); expect(f.mode(recovered.tree)).toBe("admin");
    expect(f.error(recovered.tree, "The company database did not answer. Check this device's internet connection, then try again.")).toBe(true);
    await f.submit(recovered.tree); expect(f.login).toHaveBeenCalledTimes(2);
  });
  it("ignores old catch/finally after identity adoption, logout and a newer request", async () => {
    const f = fixture(), old = f.deferred(); let first = f.panel(); f.choose(first.tree, "admin"); first = f.panel(first.owner);
    const previous = f.submit(first.tree); f.state.user = { staffId: "verified-person" }; f.state.ready = false; f.shell(); f.unmount(first.owner);
    f.state.user = null; f.state.ready = true; let next = f.panel(); expect(f.mode(next.tree)).toBe("cashier");
    f.choose(next.tree, "admin"); next = f.panel(next.owner); const current = f.deferred(), pending = f.submit(next.tree);
    old.reject(new Error("Old network timeout")); await previous;
    await f.submit(f.panel(next.owner).tree); expect(f.login).toHaveBeenCalledTimes(2);
    expect(f.error(f.panel(next.owner).tree, "The company database did not answer. Check this device's internet connection, then try again.")).toBe(false);
    current.resolve({ ok: false, code: "account-inactive", error: "Current account deactivated" }); await pending;
    expect(f.error(f.panel(next.owner).tree, "Current account deactivated")).toBe(true);
  });
  it("preserves only the intentional blank-password native username shortcut", async () => {
    const f = fixture(); f.state.username = "cashier"; f.state.password = "";
    let panel = f.panel(); f.choose(panel.tree, "admin"); panel = f.panel(panel.owner); await f.submit(panel.tree);
    expect(f.mode(f.panel(panel.owner).tree)).toBe("cashier"); expect(f.login).not.toHaveBeenCalled();
    const web = fixture("web"); web.state.username = "administrator"; web.state.password = "";
    const browser = web.panel(); web.choose(browser.tree, "cashier"); await web.submit(browser.tree);
    expect(web.mode(web.panel(browser.owner).tree)).toBe("admin"); expect(web.login).toHaveBeenCalledOnce();
  });
  it("supports a standalone panel without replacing an explicit choice after platform detection", () => {
    const native = fixture(), first = native.standalone(undefined, false);
    native.choose(first.tree, "admin"); expect(native.mode(native.standalone(first.owner).tree)).toBe("admin");
    expect(native.mode(native.standalone().tree)).toBe("cashier");
    const web = fixture("web"); expect(web.mode(web.standalone().tree)).toBe("admin");
  });
  it.each(["android", "ios", "electron", "web"] as const)("offers the existing correct connection-repair destination after %s password failure", async platform => {
    const f = fixture(platform); f.login.mockResolvedValue({ ok: false, code: "cloud-unreachable", error: "Connection unavailable" });
    const panel = f.panel(); await f.submit(panel.tree); const failed = f.panel(panel.owner);
    expect(f.error(failed.tree, "Connection unavailable")).toBe(true);
    if (platform === "web") expect(f.recoveryLink(failed.tree)).toBeUndefined();
    else expect(f.recoveryLink(failed.tree)?.props.search).toEqual({ section: "connection" });
  });
  it("keeps the existing password-manager offer after verified success even when identity adoption resets the view", async () => {
    const f = fixture(); f.state.nativePasswordManager = true; const request = f.deferred(), panel = f.panel();
    const pending = f.submit(panel.tree); f.state.user = { staffId: "verified-person" }; f.state.ready = false; f.shell(); f.unmount(panel.owner);
    request.resolve({ ok: true }); await pending;
    expect(f.offerSaveLogin).toHaveBeenCalledExactlyOnceWith("administrator@example.test", "fixture-password");
  });
});

it("retains no account or credential in a resettable, instance-local presentation controller", () => {
  const first = createLoginView(), second = createLoginView(); first.chooseMode("admin");
  const stale = first.beginRequest()!; first.reset(); const current = first.beginRequest()!;
  first.failRequest(stale, "Old refusal", "permission-denied"); first.finishRequest(stale);
  expect(first.getSnapshot()).toEqual({ mode: "admin", error: "", failure: null, busy: true });
  expect(second.getSnapshot()).toEqual({ mode: null, error: "", failure: null, busy: false });
  first.failRequest(current, "Current refusal", "invalid-credentials"); first.finishRequest(current);
  expect(first.getSnapshot()).toEqual({ mode: "admin", error: "Current refusal", failure: "invalid-credentials", busy: false });
});
