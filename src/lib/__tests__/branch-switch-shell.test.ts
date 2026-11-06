import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

type Node = { type: unknown; props: Record<string, unknown> };
type Owner = { slots: unknown[]; cursor: number };
const owner = (): Owner => ({ slots: [], cursor: 0 });
const compile = (path: string) => ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sources = Object.fromEntries(["src/platforms/web/components/pos/AppShell.tsx",
  "src/platforms/web/components/pos/ShiftGuard.tsx", "src/lib/use-confirmed-presentation.ts"].map(path => [path, compile(path)]));

/** Actual shell/guard/hooks, with unrelated network and device services inert. */
function fixture() {
  const state = { ready: true, settingsPending: false, phase: "ready", error: "", branch: "A",
    actor: "one", tenant: "one", mode: "online", epoch: 1, permitted: true, authenticated: true,
    activeShift: null as null | { state: string }, checked: true, path: "/reports/sales", flags: null as null | Record<string,boolean> };
  const user = () => state.authenticated ? { staffId: state.actor, email: "fixture@example.invalid", name: "Fixture", role: "admin", permissions: { report: state.permitted } } : null;
  let active = owner();
  const shellOwner = owner(), guardOwner = owner(), generic = new Map<string, Record<string, unknown>>();
  const modules: Record<string, Record<string, unknown>> = {};
  const noop = () => undefined;
  const react = {
    useRef(initial: unknown) { const index = active.cursor++; return active.slots[index] ??= { current: initial }; },
    useState(initial: unknown) { const index = active.cursor++; if (!(index in active.slots)) active.slots[index] = typeof initial === "function" ? initial() : initial; return [active.slots[index], noop]; },
    useEffect: noop, useContext: () => false, useCallback: (fn: unknown) => fn,
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props: props ?? {} });
  const retry = vi.fn(), openShift = vi.fn();
  Object.assign(modules, {
    react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/lib/pos-store": { money: String, usePos: () => ({ ready: state.ready, settingsScopeLoading: state.settingsPending,
      settingsScopeError: state.error || null, locationLoadError: state.error || null, retryLoad: retry, retrySettingsScope: retry,
      loadPhase: state.phase, currentStore: { id: state.branch, name: `Shop ${state.branch}` },
      stores: [{ id: "A" }, { id: "B" }], state: { stores: [], transfers: [], settings: { receipt: {}, tax: {}, integrations: { receiptPrinter: {}, rounding: {} } } },
      activeShift: state.activeShift, shiftChecked: state.checked, shiftReadError: null, openShift,
    }) },
    "@/lib/pos-auth": { useAuth: () => ({ ready: true, user: user(), authUserId: state.authenticated ? state.actor : null,
      isAdmin: false, canSwitchStores: true, can: (flag:string) => state.flags ? state.flags[flag] === true : state.permitted, terminalStoreId: null }) },
    "@/lib/page-data-cache": { pageDataScope: () => [state.actor, state.tenant, state.mode, state.epoch, state.permitted] },
    "@/hooks/use-mobile": { useIsMobile: () => false },
    "@/lib/branding": { useBranding: () => ({ company: "Fixture" }), isDesktop: () => false },
    "@/platform-config/platform": { isNative: () => false, isTerminalApp: () => false },
    "@/lib/use-revocation-check": { useRevocationCheck: () => ({ config: null, hydrating: false }) },
    "@/core/activation/registration-status": { useStartupGate: () => ({ verdict: "verified" }) },
    "@/lib/use-local-startup": { useLocalStartupReady: () => false },
    "@/lib/connection-profile": { isConnectionProfileHydrated: () => true },
    "@/lib/personal-appearance": { usePersonalAppearance: () => ({ key: "test", owner: "test", profile: { language: "en" } }), usePersonalAppearanceSync: noop },
    "@/platforms/web/components/pos/settings/use-settings-nav": { useSettingsNav: () => ({ cards: [] }) },
    "@/platforms/web/components/pos/SidebarNav": { useSidebarCollapsed: () => [false, noop] },
    "@/lib/ui-visibility": { useVisibility: () => ({ visibleRoute: () => true }) },
    "@tanstack/react-router": { useLocation: () => ({ pathname: state.path }), useNavigate: () => noop },
    "@/lib/locations": { activeLocations: (rows: unknown[]) => rows },
    "@/lib/utils": { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") },
    "@/platforms/web/components/pos/nav-config": { routePermissionForPath: (path:string) => path === "/reports/inventory" ? "can_view_inventory" : path === "/reports/history" ? "can_view_audit_trail" : "can_view_sales_reports",
      canOpenReportsHub: (can:(flag:string)=>boolean) => ["can_view_sales_reports","can_view_audit_trail","can_view_inventory"].some(can) },
  });
  const load = (path: string): Record<string, (...args: never[]) => Node> => {
    const module = { exports: {} };
    runInNewContext(sources[path], { module, exports: module.exports, require: (id: string) => {
      if (modules[id]) return modules[id];
      if (!generic.has(id)) generic.set(id, new Proxy<Record<string, unknown>>({}, { get: (target, key: string) => target[key] ??= noop }));
      return generic.get(id);
    } });
    return module.exports;
  };
  modules["@/lib/use-confirmed-presentation"] = load("src/lib/use-confirmed-presentation.ts");
  const { AppShell } = load("src/platforms/web/components/pos/AppShell.tsx");
  const { ShiftGuard } = load("src/platforms/web/components/pos/ShiftGuard.tsx");
  const child = jsx("article", { "data-test-protected-page": true });
  function render(fn: (...args: never[]) => Node, props: Record<string, unknown>, stateOwner: Owner) {
    active = stateOwner; active.cursor = 0; return fn(props as never);
  }
  const shell = () => { const frame = render(AppShell!, { children: child }, owner()); return render(frame.type as typeof AppShell, frame.props, shellOwner); };
  const guard = (scopePending: boolean) => render(ShiftGuard!, { scopePending, children: child }, guardOwner);
  const find = (value: unknown, test: (node: Node) => boolean): Node | undefined => {
    if (!value || typeof value !== "object" || !("props" in value)) return;
    const node = value as Node; if (test(node)) return node;
    for (const item of [node.props.children].flat(Infinity)) { const result = find(item, test); if (result) return result; }
  };
  return { state, shell, guard, find, child, retry, openShift, generic };
}

describe("authorized branch-view presentation", () => {
  it("allows inventory-only Reports hub and historical route without granting Sales/Audit pages", () => {
    const f=fixture();f.state.flags={can_view_inventory:true};
    for(const path of ["/reports","/reports/","/reports/inventory"]){f.state.path=path;expect(f.find(f.shell(),node=>node===f.child)).toBe(f.child);}
    for(const path of ["/reports/sales","/reports/history"]){f.state.path=path;expect(f.find(f.shell(),node=>node===f.child)).toBeUndefined();}
    f.state.flags={};f.state.path="/reports";expect(f.find(f.shell(),node=>node===f.child)).toBeUndefined();
  });
  it("keeps the shell while the new branch data/settings are unconfirmed, without old protected content", () => {
    const f = fixture();
    expect(f.find(f.shell(), n => n === f.child)).toBe(f.child);
    f.state.branch = "B"; f.state.ready = false; f.state.settingsPending = true; f.state.phase = "loading";
    const loading = f.shell();
    expect(f.find(loading, n => n.type === "aside")).toBeDefined();
    expect(f.find(loading, n => n.type === "header")).toBeDefined();
    expect(f.find(loading, n => n.props["aria-label"] === "Selected branch loading")).toBeDefined();
    expect(f.find(loading, n => n === f.child)).toBeUndefined();
    f.state.ready = true; expect(f.find(f.shell(), n => n === f.child)).toBeUndefined();
    f.state.settingsPending = false; expect(f.find(f.shell(), n => n === f.child)).toBe(f.child);
  });
  it("keeps first-load business data behind the existing full startup gate", () => {
    const f = fixture(); f.state.ready = false; f.state.settingsPending = true;
    expect(f.find(f.shell(), n => n.type === "aside")).toBeUndefined();
    expect(f.find(f.shell(), n => n === f.child)).toBeUndefined();
  });
  it.each(["actor", "tenant", "mode", "epoch", "permitted"] as const)("does not retain the shell across changed %s authority", key => {
    const f = fixture(); f.shell(); f.state.ready = false; f.state.settingsPending = true;
    if (key === "epoch") f.state.epoch++;
    else if (key === "permitted") f.state.permitted = false;
    else f.state[key] = "changed";
    expect(f.find(f.shell(), n => n.type === "aside")).toBeUndefined();
  });
  it("keeps current-scope failures visible with retry while protected page content stays absent", () => {
    const f = fixture(); f.shell(); f.state.ready = false; f.state.phase = "failed"; f.state.error = "Scoped read refused";
    const failed = f.shell();
    expect(f.find(failed, n => n.props.role === "alert")).toBeDefined();
    expect(f.find(failed, n => n.props.onClick === f.retry)).toBeDefined();
    expect(f.find(failed, n => n === f.child)).toBeUndefined();
  });
  it("retains the existing route permission refusal after a successful data read", () => {
    const f = fixture(); f.state.permitted = false;
    expect(f.find(f.shell(), n => n === f.child)).toBeUndefined();
  });
  it.each([null, { state: "ACTIVE" }, { state: "CLOSING" }])("offers no shift action from stale scope %j", shift => {
    const f = fixture(); f.state.activeShift = shift;
    const pending = f.guard(true);
    expect(pending.type).toBe("div");
    expect(f.find(pending, n => n.props.onClick !== undefined)).toBeUndefined();
    expect(f.openShift).not.toHaveBeenCalled();
  });
  it("preserves the normal ready wrapper position around navigation during pending/ready transitions", () => {
    const f = fixture(); f.state.activeShift = { state: "ACTIVE" };
    const pending = f.guard(true), ready = f.guard(false);
    expect(pending.type).toBe(ready.type);
    expect((pending.props.children as Node[])[1]!.type).toBe((ready.props.children as Node[])[1]!.type);
    expect((pending.props.children as Node[])[1]!.props.children).toBe(f.child);
    expect((ready.props.children as Node[])[1]!.props.children).toBe(f.child);
  });
});
