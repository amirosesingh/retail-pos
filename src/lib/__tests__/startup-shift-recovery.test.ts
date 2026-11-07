import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const session = require("../../../electron/admin-session.cjs"), guard = require("../../../electron/ipc-guard.cjs");
const { installLegacyShiftRecoveryIpc, CHANNELS } = require("../../../electron/sync/legacy-shift-recovery-ipc.cjs");
const { install } = require("../../../electron/ipc-privilege.cjs");
const { DatabaseService } = require("../../../electron/db/service.cjs");
const branch = "00000000-0000-4000-8000-000000000001", author = "00000000-0000-4000-8000-000000000002";
const shiftId = "00000000-0000-4000-8000-000000000004";
const openedAt = "2026-11-05T09:16:00.0000000+08:00";
const closedAt = "2026-11-06T20:46:42.1234560+08:00";
const local = { status: "OPEN", openedAt, closedAt: null, updatedAt: openedAt, rowVersion: "1", countedCash: null, countedCard: null,
  countedDigital: null, expectedCash: null, expectedCard: null, expectedDigital: null };
const cloud = { ...local, status: "CLOSED", closedAt, updatedAt: closedAt, rowVersion: "4", countedCash: "123.45" };
const comparison = { shiftId, classification: "unverified-difference-needs-review", local, cloud };
const savedShifts = { available: true, items: [{ shiftId, status: local.status, openedAt, closedAt: null }], nextAfterId: null };
const openShiftLabel = `${openedAt}OPEN · ${shiftId.slice(0, 8)}`;
type Element = { type: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown> };
type Owner = { index: number; effects: number; slots: unknown[]; deps: Array<unknown[] | undefined>; cleanups: Array<unknown> };

function fixture() {
  const handlers = new Map(), terminal = { tokenId: "00000000-0000-4000-8000-000000000003", deviceType: "pc", deviceUse: "operations", locationId: branch, deviceBindingProof: "a".repeat(64) };
  const manager = { pool: {}, get tradingReady() { throw Error("Sign-in must not require trading readiness"); } };
  const ipc = { handle: (name: string, handler: unknown) => handlers.set(name, handler) }; install(ipc);
  const main = readFileSync("electron/main.cjs", "utf8"), start = main.indexOf('  ipcMain.handle("auth:cashier-login",');
  const auth = main.slice(start, main.indexOf('  ipcMain.handle("app:ready",', start));
  const epoch = main.slice(main.indexOf("function captureSessionAdoption()"), main.indexOf("\nfunction enrollCurrentShiftAuthor"));
  const account = { id: author, username: "fixture.admin", role: "admin", store_id: branch, permissions: {} };
  const fetch = vi.fn(async () => Response.json({ ok: true, cashier: account, sessionToken: "synthetic-session" }));
  new Function("ipcMain", "guard", "adminSession", "databaseManager", "terminalStore", "cloudCredentials", "authorizationServerUrl", "localBranchId", "fetch", "syncCloud", "enrollCurrentShiftAuthor", "rememberVerifiedBranch", `let sessionAdoptionRevision=0;${epoch}${auth}`)(
    ipc, guard, session, manager, { read: () => terminal }, { read: () => ({ url: "https://fixture.supabase.co" }) }, () => "https://fixture.invalid", () => branch, fetch, { setAuthorizationProof() {} }, () => {}, () => {});
  const sender = {}, frame = {}, event = { sender, senderFrame: frame };
  const list = vi.fn(async (): Promise<Record<string, unknown>> => ({ available: true, items: [] }));
  const preview = vi.fn(async (): Promise<Record<string, unknown>> => ({}));
  const approve = vi.fn(), acceptCloud = vi.fn();
  installLegacyShiftRecoveryIpc({ ipcMain: ipc, service: { list, preview, approve, acceptCloud }, session, isPosSender: (candidate: typeof event) => candidate.sender === sender && candidate.senderFrame === frame });
  let owner: Owner, pathname = "/database-startup", verification: Promise<{ ok: boolean }> | null = null;
  const owners = new Map<unknown, Owner>(), effects: Array<() => unknown> = [];
  const react = {
    useState(initial: unknown) { const current = owner, index = current.index++; if (!(index in current.slots)) current.slots[index] = typeof initial === "function" ? initial() : initial; return [current.slots[index], (value: unknown) => { current.slots[index] = typeof value === "function" ? value(current.slots[index]) : value; }]; },
    useRef(initial: unknown) { const current = owner, index = current.index++; if (!(index in current.slots)) current.slots[index] = { current: initial }; return current.slots[index]; },
    useEffect(work: () => unknown, deps: unknown[]) { const current = owner, index = current.effects++, previous = current.deps[index]; if (previous && deps.every((value, n) => Object.is(value, previous[n]))) return; current.deps[index] = deps; effects.push(() => { const cleanup = current.cleanups[index]; if (typeof cleanup === "function") cleanup(); current.cleanups[index] = work(); }); },
    useCallback(value: unknown, deps: unknown[]) {
      const index = owner.index++;
      const saved = owner.slots[index] as { value: unknown; deps: unknown[] } | undefined;
      if (saved && deps.every((dependency, index) => Object.is(dependency, saved.deps[index]))) return saved.value;
      owner.slots[index] = { value, deps };
      return value;
    },
  };
  const jsx = (type: Element["type"], props: Element["props"]) => ({ type, props: props ?? {} });
  const authState = () => { const person = session.identity(); return { ready: true, user: person ? { staffId: person.authorId } : null, isAdmin: person?.source === "pos" && person?.level === "admin", authUserId: person?.authorId, logout: async () => session.clear() }; };
  const navigate = vi.fn(({ to }: { to: string }) => { pathname = to; });
  const databaseListeners = new Set<(value: object) => void>();
  let sqlConnected = true;
  const databaseService = new DatabaseService({ secureConfig: { enabled: () => true, profile: () => ({ database: "owned-startup-fixture" }) },
    manager: { isConnected: () => sqlConnected }, publish: (value: object) => { for (const listener of databaseListeners) listener(value); } });
  databaseService.validated = true;
  databaseService.transition("enabled_bootstrapping", { code: "ELOCAL_PENDING_UNVERIFIED", error: "Retained shifts need review" });
  const modules: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@tanstack/react-router": { useLocation: ({ select }: { select: (value: { pathname: string }) => unknown }) => select({ pathname }), useNavigate: () => navigate, createFileRoute: () => (options: object) => options },
    "lucide-react": new Proxy({}, { get: () => "icon" }), "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": { Input: "input" }, "@/components/ui/label": { Label: "label" },
    "@/components/ui/dialog": { Dialog: ({ open, children }: Record<string, unknown>) => jsx("dialog", { children: open ? children : null }),
      DialogContent: "div", DialogDescription: "p", DialogHeader: "header", DialogTitle: "h2" },
    "@/lib/pos-auth": { useAuth: authState }, "@/lib/branding": { isDesktop: () => true },
    "@/lib/login-view": { createLoginView: () => ({ chooseMode() {} }) },
    "@/lib/desktop-pos-session": { ensureDesktopPosSession: async () => verification ?? ({ ok: session.identity()?.source === "pos", level: session.identity()?.level }) },
    "@/platforms/web/components/pos/TerminalLogin": { TerminalLogin: () => jsx("ordinary-pos-login", {}) },
    "@/lib/recovery-route": { isRecoveryPath: (path: string) => path === "/recovery" },
    "@/components/shared/TillLoader": { TillLoader: () => jsx("trading-blocked", {}) },
    "@/core/local-db/db-mode": { setStartupOnlineMode() {}, LOCAL_DATABASE_SETTINGS_REQUEST: "fixture-sql-settings", ONLINE_STARTUP_OVERRIDE: "fixture-online" },
    "@/lib/desktop-startup-progress": { observeDesktopStartup: () => () => {}, startupPresentation: () => ({}) }, "sonner": { toast: { dismiss() {} } },
    "@/platforms/windows/components/LocalDatabaseWizard": { LocalDatabaseWizard: () => jsx("connection-wizard", {}) },
    "@/core/activation/connection-health": { checkHealth: async () => ({ cloud: true }), cloudDiagnosis: () => ({ issue: "none" }) },
  };
  const retryStartup = vi.fn(async () => databaseService.snapshot());
  const legacyRecovery = Object.fromEntries(Object.entries(CHANNELS).map(([name, channel]) => [name, (value: unknown) => handlers.get(channel)(event, value)]));
  const load = (path: string) => { const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, module = { exports: {} }; runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => { if (!(name in modules)) throw Error("Unexpected UI dependency " + name); return modules[name]; }, crypto: globalThis.crypto, navigator: { onLine: true }, window: { sqlAdmin: { adminStatus: async () => session.status() }, sessionStorage: { getItem: () => null, removeItem() {} }, pos: { database: { getState: async () => databaseService.snapshot(), retryStartup, subscribe: (listener: (value: object) => void) => { databaseListeners.add(listener); return () => databaseListeners.delete(listener); } }, sync: { legacyRecovery } }, addEventListener() {}, removeEventListener() {} } }); return module.exports as Record<string, (props: Record<string, unknown>) => Element>; };
  modules["@/lib/desktop-storage-route"] = load("src/lib/desktop-storage-route.ts");
  modules["./LegacyShiftRecoveryReview"] = load("src/platforms/windows/components/LegacyShiftRecoveryReview.tsx");
  modules["./HeldBillRecoveryReview"] = load("src/platforms/windows/components/HeldBillRecoveryReview.tsx");
  const Startup = load("src/platforms/windows/components/StartupShiftRecoveryReview.tsx").StartupShiftRecoveryReview;
  modules["@/platforms/windows/components/StartupShiftRecoveryReview"] = { StartupShiftRecoveryReview: Startup };
  const Route = load("src/routes/database-startup.tsx").Route as unknown as { component: (props: Record<string, unknown>) => Element };
  const Boot = load("src/platforms/windows/components/DatabaseBoot.tsx").NativeBoot;
  const buttons = new Map<string, () => Promise<void>>();
  const renderNode = (node: unknown): string => {
    if (!node || typeof node === "boolean") return ""; if (Array.isArray(node)) return node.map(renderNode).join(""); if (typeof node !== "object") return String(node);
    const item = node as Element; if (typeof item.type === "function") { const previous = owner; owner = owners.get(item.type) ?? { index: 0, effects: 0, slots: [], deps: [], cleanups: [] }; owner.index = 0; owner.effects = 0; owners.set(item.type, owner); const result = renderNode(item.type(item.props)); owner = previous; return result; }
    const contents = renderNode(item.props.children);
    if (item.type === "button" && !item.props.disabled && typeof item.props.onClick === "function") buttons.set(contents.replace(/<[^>]*>/g, ""), item.props.onClick as () => Promise<void>);
    return `<${item.type}>${contents}</${item.type}>`;
  };
  const render = async () => { let result = ""; for (let attempt = 0; attempt < 5; attempt++) { buttons.clear(); result = renderNode(jsx(Boot, { children: jsx(Route.component, {}) })); for (const effect of effects.splice(0)) effect(); await Promise.resolve(); await Promise.resolve(); } return result; };
  return { render, navigate, retry: () => buttons.get("Retry local database")!(), retryStartup, snapshot: () => databaseService.snapshot(),
    click: (label: string) => buttons.get(label)!(), list, preview, approve, acceptCloud,
    database: (value: { validated?: boolean; connected?: boolean; state?: string; detail?: object }) => {
      if (value.validated !== undefined) databaseService.validated = value.validated;
      if (value.connected !== undefined) sqlConnected = value.connected;
      databaseService.transition(value.state ?? databaseService.state, value.detail ?? databaseService.detail);
    },
    route: (value: string) => { pathname = value; }, login: () => handlers.get("auth:cashier-login")(event, { username: "fixture.admin", pin: "0000" }),
    review: () => handlers.get(CHANNELS.list)(event, {}), account, manager, fetch, deferVerification: (value: Promise<{ ok: boolean }>) => { verification = value; } };
}
afterEach(() => { session.clear(); session.clearRecovery(); });

describe("held startup review with actual native POS identity admission", () => {
  it("offers ordinary sign-in on the existing startup route while normal trading remains gated", async () => {
    const f = fixture(); expect(f.snapshot()).toMatchObject({ state: "enabled_bootstrapping", connected: true, tradingReady: true });
    expect(await f.render()).toContain("ordinary-pos-login"); expect(f.navigate).not.toHaveBeenCalled();
    f.route("/"); expect(await f.render()).toContain("trading-blocked");
    expect(await f.review()).toMatchObject({ ok: false }); expect(f.list).not.toHaveBeenCalled();
  });
  it("actual verified Main Admin admission opens review on startup but does not release the trading gate", async () => {
    const f = fixture(); expect(await f.login()).toMatchObject({ ok: true }); expect(session.identity()).toMatchObject({ source: "pos", level: "admin", authorId: author });
    expect(await f.render()).toContain("Review saved closings"); expect(await f.review()).toMatchObject({ ok: true });
    f.route("/"); expect(await f.render()).toContain("trading-blocked");
  });
  it("staff, emergency and signed-out identities cannot reach privileged review", async () => {
    const f = fixture(); f.account.role = "staff"; await f.login(); expect(await f.render()).not.toContain("Review saved closings"); expect(await f.review()).toMatchObject({ ok: false });
    session.clear(); session.grantRecovery(); expect(await f.render()).not.toContain("Review saved closings"); expect(await f.review()).toMatchObject({ ok: false });
    expect(f.list).not.toHaveBeenCalled();
  });
  it("a logout while native verification awaits cannot open stale Administrator review", async () => {
    const f = fixture(); await f.login(); let resolve!: (value: { ok: boolean }) => void;
    f.deferVerification(new Promise(accept => { resolve = accept; })); expect(await f.render()).not.toContain("Review saved closings");
    session.clear(); await f.render(); resolve({ ok: true }); expect(await f.render()).not.toContain("Review saved closings"); expect(await f.review()).toMatchObject({ ok: false });
  });
  it("backend terminal-proof denial cannot be promoted to a startup reviewer", async () => {
    const f = fixture(); f.fetch.mockResolvedValueOnce(Response.json({ ok: false, error: "Registration denied" }, { status: 403 }));
    expect(await f.login()).toMatchObject({ ok: false }); expect(session.identity()).toBeNull(); expect(await f.render()).toContain("ordinary-pos-login"); expect(await f.review()).toMatchObject({ ok: false });
  });
  it.each([
    { validated: false, state: "enabled_validating", detail: { status: "migration_required" } },
    { validated: false, state: "enabled_validating", detail: { status: "applying_migration" } },
    { validated: true, state: "enabled_bootstrapping", detail: { status: "applying_migration" } },
    { connected: false },
  ])("does not offer review against disconnected, unvalidated or migrating SQL: %j", async value => {
    const f = fixture(); f.database(value); await f.login();
    expect(await f.render()).not.toContain("Review saved closings");
    expect(await f.render()).not.toContain("ordinary-pos-login"); expect(f.navigate).not.toHaveBeenCalled();
    expect(f.list).not.toHaveBeenCalled();
  });
  it("leaves recovery only after the existing storage route confirms completed startup", async () => {
    const f = fixture(); await f.login(); expect(await f.render()).toContain("Review saved closings");
    f.database({ state: "enabled_ready", detail: {} }); await f.render();
    expect(f.navigate).toHaveBeenCalledWith({ to: "/" });
  });
  it("keeps a schema-ready retained-shift failure on recovery after a manual retry", async () => {
    const f = fixture(); await f.login(); expect(await f.render()).toContain("Review saved closings");
    await f.retry(); const html = await f.render(); expect(f.retryStartup).toHaveBeenCalledOnce();
    expect(f.navigate).not.toHaveBeenCalled(); expect(html).toContain("Review saved closings");
    expect(html).toContain("Saved local work needs review"); expect(html).toContain("SQL Server is connected");
    expect(html).not.toContain("Local database is unavailable");
    expect(html.match(/Retained shifts need review/g)).toHaveLength(1);
  });
  it("shows both versions and timestamps to a verified Administrator with read-only recovery support", async () => {
    const f = fixture();
    f.list.mockResolvedValue({ ...savedShifts, readOnly: true });
    f.preview.mockResolvedValue({ ...comparison, readOnly: true, captureKey: null, canApprove: false, canAcceptCloud: false });
    await f.login(); await f.render(); await f.click("Review saved closings");
    expect(await f.render()).toContain("Saving a recovery decision requires the approved recovery metadata upgrade");
    await f.click(openShiftLabel);
    const html = await f.render();
    expect(html).toContain("Local SQL Server"); expect(html).toContain("Cloud");
    expect(html).toContain(openedAt); expect(html).toContain(closedAt);
    expect(html).toContain("<dt>Record version</dt><dd>1</dd>"); expect(html).toContain("<dt>Record version</dt><dd>4</dd>");
    expect(html).not.toContain("Save reviewed recovery"); expect(html).not.toContain("Use reviewed cloud closing locally");
    expect(f.preview).toHaveBeenCalledExactlyOnceWith(shiftId);
    expect(f.approve).not.toHaveBeenCalled(); expect(f.acceptCloud).not.toHaveBeenCalled(); expect(f.navigate).not.toHaveBeenCalled();
  });
  it("rejects a malformed read-only response that includes a write capability", async () => {
    const f = fixture();
    f.list.mockResolvedValue({ ...savedShifts, readOnly: true });
    f.preview.mockResolvedValue({ ...comparison, readOnly: true, captureKey: null, canApprove: false, canAcceptCloud: true });
    await f.login(); await f.render(); await f.click("Review saved closings"); await f.render(); await f.click(openShiftLabel);
    const html = await f.render();
    expect(html).toContain("The saved shift response is incomplete"); expect(html).not.toContain(closedAt);
    expect(f.approve).not.toHaveBeenCalled(); expect(f.acceptCloud).not.toHaveBeenCalled();
  });
  it("continues to show the existing authorized decision once a writable list and preview are verified", async () => {
    const f = fixture();
    f.list.mockResolvedValue(savedShifts);
    f.preview.mockResolvedValue({ ...comparison, captureKey: "a".repeat(64), canApprove: false, canAcceptCloud: true });
    await f.login(); await f.render(); await f.click("Review saved closings"); await f.render(); await f.click(openShiftLabel);
    const html = await f.render();
    expect(html).toContain("Use reviewed cloud closing locally"); expect(html).not.toContain("Read-only comparison");
  });
});
