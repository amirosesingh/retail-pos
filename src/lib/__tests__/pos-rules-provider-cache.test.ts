import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_POS_RULES } from "../pos-rules";

const mock = vi.hoisted(() => ({
  backend: "https://pos.test", project: "https://project.test", terminal: "TERMINAL-1",
  offline: false, available: true, branch: "branch-a", cache: new Map<string, string>(),
  data: new Map<string, unknown>(), query: undefined as undefined | (() => Promise<unknown>),
  queryKey: "", afterFetch: undefined as undefined | (() => void),
  effects: [] as Array<() => unknown>, publish: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useEffect: (effect: () => unknown) => { mock.effects.push(effect); },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    setQueryData: (key: unknown, data: unknown) => mock.data.set(JSON.stringify(key), data),
    refetchQueries: async () => {}, invalidateQueries: async () => {}, getQueryState: () => null,
  }),
  useQuery: (options: { queryKey: unknown; queryFn: () => Promise<unknown> }) => {
    mock.query = options.queryFn; mock.queryKey = JSON.stringify(options.queryKey);
    return { data: mock.data.get(mock.queryKey), isPending: !mock.data.has(mock.queryKey) };
  },
}));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: mock.project }) }));
vi.mock("../server-origin", () => ({
  serverOrigin: () => mock.backend,
  posFetch: async () => {
    mock.afterFetch?.();
    return mock.offline ? Response.json({ error: "temporarily unavailable" }, { status: 503 }) : Response.json({
      ok: true, branchId: mock.branch, backend: "database", revision: "verified-revision", rowVersion: 7,
      fetchedAt: 1000, rules: { ...DEFAULT_POS_RULES }, shiftSharingAvailable: mock.available,
    });
  },
}));
vi.mock("../pos-rules.functions", () => ({ getPosRules: vi.fn() }));
vi.mock("../pos-caller-auth", () => ({ getPosCallerAuth: async () => ({ accessToken: "isolated-staff" }) }));
vi.mock("../activity-journal", () => ({ terminalId: () => mock.terminal }));
vi.mock("../settings-refresh", () => ({ subscribeSettingsRefresh: () => () => {} }));
vi.mock("../pos-rules-log", () => ({ logRules: vi.fn() }));
vi.mock("../shift-sharing-policy", () => ({ publishShiftSharing: mock.publish }));
vi.mock("@/platform-config/platform", () => ({ platformName: () => "electron" }));
vi.mock("@/platform-config/features", () => ({ isWindowsShell: () => true }));

type RulesView = { source: string; shiftSharingAvailable: boolean; usingDefaults: boolean; notVerified: boolean; status: string; statusText: string; rules: typeof DEFAULT_POS_RULES; cacheScope: string; confirmSaved: (answer: unknown) => Promise<void> };
let view: RulesView;
let Provider: ComponentType<{ storeId: string; children: ReturnType<typeof createElement> }>;
let useRules: () => RulesView;
const draw = () => {
  mock.effects = [];
  const html = renderToStaticMarkup(createElement(Provider, { storeId: mock.branch, children: createElement(function Read() {
    view = useRules(); return createElement("span", {}, view.source);
  }) }));
  mock.effects.splice(0).forEach(effect => effect());
  return html;
};
async function loadModule() {
  const loaded = await import("../pos-rules.tsx");
  Provider = loaded.PosRulesProvider; useRules = loaded.usePosRules; draw();
}
async function read() { draw(); const key = mock.queryKey; mock.data.set(key, await mock.query!()); draw(); }
beforeEach(async () => {
  vi.resetModules(); mock.backend = "https://pos.test"; mock.project = "https://project.test"; mock.terminal = "TERMINAL-1";
  mock.offline = false; mock.available = true; mock.branch = "branch-a"; mock.cache.clear(); mock.data.clear(); mock.afterFetch = undefined;
  mock.publish.mockClear();
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:8080" }, pos: {
    getSetting: async (name: string) => ({ value: mock.cache.get(name) ?? null }),
    setSetting: async (name: string, value: string) => { mock.cache.set(name, value); },
  } });
  await loadModule();
});
it("retains verified capability through a lost connection and an Electron restart", async () => {
  await read(); expect(view.shiftSharingAvailable).toBe(true);
  expect(JSON.parse(mock.cache.get("pos-rules-last-good")!).shiftSharingAvailable).toBe(true);
  mock.offline = true; await read(); expect(view.source).toBe("LAST_KNOWN_GOOD"); expect(view.shiftSharingAvailable).toBe(true);
  vi.resetModules(); mock.data.clear(); await loadModule(); await read();
  expect(view.source).toBe("LAST_KNOWN_GOOD"); expect(view.shiftSharingAvailable).toBe(true);
});
it.each(["backend", "project", "terminal", "branch"] as const)("never carries rules/capability across a changed %s", async field => {
  await read(); expect(view.shiftSharingAvailable).toBe(true); mock.offline = true;
  if (field === "backend") mock.backend = "https://other.test";
  if (field === "project") mock.project = "https://other-project.test";
  if (field === "terminal") mock.terminal = "TERMINAL-2";
  if (field === "branch") mock.branch = "branch-b";
  vi.resetModules(); mock.data.clear(); await loadModule(); await read();
  expect(view.source).toBe("DEFAULT_SAFETY"); expect(view.usingDefaults).toBe(true); expect(view.shiftSharingAvailable).toBe(false);
});
it("does not cache a response if the connection profile changes during the request", async () => {
  mock.afterFetch = () => { mock.backend = "https://changed.test"; };
  await read(); expect(mock.cache.size).toBe(0); expect(view.shiftSharingAvailable).toBe(false);
});
it("persists capability changes even when the rules revision did not change", async () => {
  await read(); mock.available = false; await read();
  expect(view.shiftSharingAvailable).toBe(false);
  expect(JSON.parse(mock.cache.get("pos-rules-last-good")!).shiftSharingAvailable).toBe(false);
});
it("keeps the already verified capability when a successful save omits that field", async () => {
  await read(); await view.confirmSaved({ rules: DEFAULT_POS_RULES, rowVersion: 8, fetchedAt: 2000 }); draw();
  expect(view.shiftSharingAvailable).toBe(true);
  expect(JSON.parse(mock.cache.get("pos-rules-last-good")!).shiftSharingAvailable).toBe(true);
});
it("preserves a context-bound pending offline rule edit and its verified capability after restart", async () => {
  await read();
  const entry = JSON.parse(mock.cache.get("pos-rules-last-good")!);
  mock.cache.set("pos-rules-last-good", JSON.stringify({ ...entry,
    pending: true, revision: "pending:2000", syncedAt: Date.now(),
    rules: { ...entry.rules, max_refund_days_limit: 21 },
  }));
  vi.resetModules(); mock.data.clear(); mock.offline = true; await loadModule(); await read();
  expect(view.source).toBe("LOCAL_PENDING"); expect(view.shiftSharingAvailable).toBe(true);
});
it("picks up a newly saved pending edit without restarting or discarding its verified capability", async () => {
  await read();
  const entry = JSON.parse(mock.cache.get("pos-rules-last-good")!);
  mock.cache.set("pos-rules-last-good", JSON.stringify({ ...entry,
    pending: true, revision: "local:2000", syncedAt: Date.now(), rowVersion: 8,
    rules: { ...entry.rules, max_refund_days_limit: 21 },
  }));
  mock.offline = true; await read();
  expect(view.source).toBe("LOCAL_PENDING"); expect(view.shiftSharingAvailable).toBe(true);
});
it.each([false, true])("preserves matched legacy operating rules read-only during an offline upgrade (pending=%s)", async pending => {
  const legacy = JSON.stringify({ terminalId: mock.terminal, branchId: mock.branch,
    revision: pending ? "local:old" : "old-confirmed", syncedAt: Date.now() - 365 * 86400000,
    pending, rowVersion: 8, rules: { ...DEFAULT_POS_RULES, allow_branch_shift_sharing: false, max_refund_days_limit: 21 },
    shiftSharingAvailable: true,
  });
  mock.cache.set("pos-rules-last-good", legacy); mock.offline = true; await read();
  expect(view.source).toBe("LEGACY_CACHE"); expect(view.usingDefaults).toBe(false); expect(view.notVerified).toBe(true);
  expect(view.rules.allow_branch_shift_sharing).toBe(false); expect(view.rules.max_refund_days_limit).toBe(21);
  expect(mock.publish).toHaveBeenCalledWith(mock.branch, false);
  expect(view.shiftSharingAvailable).toBe(false); expect(view.statusText).toContain("before editing");
  expect(view.status).toBe(pending ? "PENDING_UPLOAD" : "DEGRADED");
  expect(mock.cache.get("pos-rules-last-good")).toBe(legacy);
});
it("replaces a read-only legacy confirmed cache only after a genuine online rules response", async () => {
  mock.cache.set("pos-rules-last-good", JSON.stringify({ terminalId: mock.terminal, branchId: mock.branch,
    revision: "old-confirmed", syncedAt: Date.now() + 86400000, rowVersion: 7,
    rules: { ...DEFAULT_POS_RULES, max_refund_days_limit: 21 },
  }));
  mock.offline = true; await read(); expect(view.source).toBe("LEGACY_CACHE");
  mock.offline = false; await read(); expect(view.source).toBe("DATABASE"); expect(view.shiftSharingAvailable).toBe(true);
  expect(JSON.parse(mock.cache.get("pos-rules-last-good")!).cacheScope).toBe(view.cacheScope);
});
it("persists genuine connection verification even if legacy rules and capability have the same revision/value", async () => {
  mock.available = false;
  mock.cache.set("pos-rules-last-good", JSON.stringify({ terminalId: mock.terminal, branchId: mock.branch,
    revision: "verified-revision", syncedAt: 1000, rowVersion: 7, rules: DEFAULT_POS_RULES,
  }));
  await read(); expect(view.source).toBe("DATABASE"); expect(view.notVerified).toBe(false);
  expect(JSON.parse(mock.cache.get("pos-rules-last-good")!).cacheScope).toBe(view.cacheScope);
});
it.each([90, 365])("does not abandon a %s-day pending edit when unchanged cloud rules return", async days => {
  await read(); const entry = JSON.parse(mock.cache.get("pos-rules-last-good")!);
  const pending = JSON.stringify({ ...entry, pending: true, revision: "local:offline", rowVersion: 8,
    syncedAt: Date.now() - days * 86400000, rules: { ...entry.rules, max_refund_days_limit: 21 },
  });
  mock.cache.set("pos-rules-last-good", pending); await read();
  expect(view.source).toBe("LOCAL_PENDING"); expect(view.status).toBe("PENDING_UPLOAD");
  expect(view.rules.max_refund_days_limit).toBe(21); expect(view.shiftSharingAvailable).toBe(true);
  expect(mock.cache.get("pos-rules-last-good")).toBe(pending);
});
