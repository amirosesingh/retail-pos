import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_POS_RULES } from "../pos-rules";

const mock = vi.hoisted(() => ({
  backend: "https://pos.test", project: "https://project.test", terminal: "TERMINAL-1",
  offline: false, available: true, branch: "branch-a", cache: new Map<string, string>(),
  data: new Map<string, unknown>(), query: undefined as undefined | (() => Promise<unknown>),
  queryKey: "", afterFetch: undefined as undefined | (() => void),
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
vi.mock("../shift-sharing-policy", () => ({ publishShiftSharing: vi.fn() }));
vi.mock("@/platform-config/platform", () => ({ platformName: () => "electron" }));
vi.mock("@/platform-config/features", () => ({ isWindowsShell: () => true }));

type RulesView = { source: string; shiftSharingAvailable: boolean; usingDefaults: boolean; cacheScope: string; confirmSaved: (answer: unknown) => Promise<void> };
let view: RulesView;
let Provider: ComponentType<{ storeId: string; children: ReturnType<typeof createElement> }>;
let useRules: () => RulesView;
const draw = () => renderToStaticMarkup(createElement(Provider, { storeId: mock.branch, children: createElement(function Read() {
  view = useRules(); return createElement("span", {}, view.source);
}) }));
async function loadModule() {
  const loaded = await import("../pos-rules.tsx");
  Provider = loaded.PosRulesProvider; useRules = loaded.usePosRules; draw();
}
async function read() { draw(); const key = mock.queryKey; mock.data.set(key, await mock.query!()); draw(); }
beforeEach(async () => {
  vi.resetModules(); mock.backend = "https://pos.test"; mock.project = "https://project.test"; mock.terminal = "TERMINAL-1";
  mock.offline = false; mock.available = true; mock.branch = "branch-a"; mock.cache.clear(); mock.data.clear(); mock.afterFetch = undefined;
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
