import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_POS_RULES } from "../pos-rules";

const mock = vi.hoisted(() => ({
  source: "DATABASE", loading: false, usingDefaults: false, notVerified: false,
  permission: true, slots: [] as unknown[], cursor: 0,
  refs: [] as Array<{ current: unknown }>, refCursor: 0, branch: "branch", cacheScope: "verified-scope",
  userId: "user-a",
  buttons: [] as Array<Record<string, unknown>>, switches: [] as Array<Record<string, unknown>>,
  queue: vi.fn(), auth: vi.fn(), refresh: vi.fn(), save: vi.fn(), fetch: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useRef: (initial: unknown) => {
    const index = mock.refCursor++;
    if (!(index in mock.refs)) mock.refs[index] = { current: initial };
    return mock.refs[index];
  },
  useState: (initial: unknown) => {
    const index = mock.cursor++;
    if (!(index in mock.slots)) mock.slots[index] = index === 0
      ? { ...(initial as typeof DEFAULT_POS_RULES), prevent_negative_stock_sale: !(initial as typeof DEFAULT_POS_RULES).prevent_negative_stock_sale }
      : initial;
    return [mock.slots[index], (next: unknown) => { mock.slots[index] = next; }];
  },
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/lib/pos-rules.tsx", () => ({ usePosRules: () => ({
  rules: DEFAULT_POS_RULES, source: mock.source, loading: mock.loading,
  usingDefaults: mock.usingDefaults, notVerified: mock.notVerified,
  failureText: mock.notVerified ? "Unavailable" : "", status: mock.notVerified ? "NOT_VERIFIED" : "DEGRADED",
  refresh: mock.refresh, confirmSaved: vi.fn(), branchId: mock.branch, terminalId: "terminal", rowVersion: 7,
  cacheScope: mock.cacheScope,
  shiftSharingAvailable: true,
}) }));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({ isAdmin: false, user: { staffId: mock.userId }, authUserId: mock.userId, terminalUser: null, can: () => mock.permission }) }));
vi.mock("@/lib/pos-store", () => ({ usePos: () => ({ currentStore: { id: mock.branch, name: "Branch" } }) }));
vi.mock("@/lib/pos-caller-auth", () => ({ getPosCallerAuth: mock.auth }));
vi.mock("@/lib/pos-rules-client", () => ({ savePosRules: mock.save }));
vi.mock("@/lib/server-origin", () => ({ serverOrigin: () => "", posFetch: mock.fetch }));
vi.mock("@/lib/pos-rules-offline", () => ({ queueRulesSave: mock.queue }));
vi.mock("@/platform-config/features", () => ({ isWindowsShell: () => true }));
vi.mock("@/lib/idle-timeout-client", () => ({ requestIdleTimeout: vi.fn() }));
vi.mock("@/lib/sync-engine", () => ({ broadcastSettingsChange: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/button", () => ({ Button: (props: Record<string, unknown>) => {
  mock.buttons.push(props); return createElement("button", props as object, props.children as ReactNode);
} }));
vi.mock("@/components/ui/switch", () => ({ Switch: (props: Record<string, unknown>) => {
  mock.switches.push(props); return createElement("input", { disabled: props.disabled as boolean, "aria-label": props["aria-label"] as string });
} }));
vi.mock("@/components/ui/input", () => ({ Input: (props: object) => createElement("input", props) }));
vi.mock("@/components/ui/label", () => ({ Label: ({ children }: { children: ReactNode }) => createElement("label", {}, children) }));
vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));
vi.mock("@/components/ui/preset-number", () => ({ PresetNumber: () => null }));
vi.mock("@/platforms/web/components/pos/settings/SettingsSection", () => ({ SettingsSections: ({ items }: { items: Array<{ content: ReactNode }> }) => items.map((item, index) => createElement("div", { key: index }, item.content)) }));
vi.mock("@/platforms/web/components/pos/settings/SaveIndicator", () => ({ SaveIndicator: () => null }));
vi.mock("@/platforms/web/components/pos/settings/SettingsShell", () => ({ SettingsShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/platforms/web/components/pos/settings/SettingsTabs", () => ({ SettingsTabs: () => null }));
vi.mock("@/platforms/web/components/pos/settings/SettingsBackLink", () => ({ SettingsBackLink: () => null }));
vi.mock("@/platforms/web/components/pos/settings/panels/OperationalRulesPanel", () => ({ OperationalRulesPanel: () => null }));
vi.mock("@/platforms/web/components/admin/ShiftClosingPolicy", () => ({ ShiftClosingPolicy: () => null }));
vi.mock("@/platforms/web/components/admin/SponsorshipSalesPolicy", () => ({ SponsorshipSalesPolicy: () => null }));
vi.mock("@/platforms/web/components/admin/OperationalTablePolicies", () => ({ OperationalTablePolicies: () => null }));

import { RulesSettings } from "@/routes/settings.rules";
const draw = () => {
  mock.cursor = 0; mock.refCursor = 0; mock.buttons = []; mock.switches = [];
  return renderToStaticMarkup(createElement(RulesSettings, { embedded: true }));
};
const saveButton = () => mock.buttons.find(button => Array.isArray(button.children) && button.children.includes("Save rules"))!;
beforeEach(() => {
  mock.source = "DATABASE"; mock.loading = false; mock.usingDefaults = false; mock.notVerified = false; mock.permission = true;
  mock.slots = []; mock.refs = []; mock.branch = "branch"; mock.cacheScope = "verified-scope";
  mock.userId = "user-a";
  mock.auth.mockReset().mockResolvedValue({}); mock.queue.mockReset().mockResolvedValue(undefined);
  mock.refresh.mockReset().mockResolvedValue(undefined); mock.save.mockReset(); mock.fetch.mockReset();
});
it.each(["DEFAULT_SAFETY", "UNAVAILABLE", "LEGACY_CACHE"])("does not edit or save unverified %s defaults, even through a stale callback", async source => {
  mock.source = source; mock.usingDefaults = source !== "LEGACY_CACHE"; mock.notVerified = source !== "LEGACY_CACHE";
  draw();
  expect(saveButton().disabled).toBe(true);
  expect(mock.switches.length).toBeGreaterThan(0);
  expect(mock.switches.every(switchProps => switchProps.disabled)).toBe(true);
  const before = mock.slots[0];
  (mock.switches[0].onCheckedChange as (value: boolean) => void)(true);
  expect(mock.slots[0]).toBe(before);
  await (saveButton().onClick as () => Promise<void>)();
  expect(mock.auth).not.toHaveBeenCalled(); expect(mock.queue).not.toHaveBeenCalled();
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
});
it.each(["DATABASE", "LAST_KNOWN_GOOD", "LOCAL_PENDING"])("preserves authorized editing and offline queueing from verified %s", async source => {
  mock.source = source;
  draw();
  expect(saveButton().disabled).toBe(false);
  expect(mock.switches.some(switchProps => !switchProps.disabled)).toBe(true);
  await (saveButton().onClick as () => Promise<void>)();
  expect(mock.queue).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch", terminalId: "terminal", expectedVersion: 7 }));
});
it("holds edits while the first rules read is loading", async () => {
  mock.loading = true; draw(); expect(saveButton().disabled).toBe(true);
  await (saveButton().onClick as () => Promise<void>)();
  expect(mock.auth).not.toHaveBeenCalled();
});
it("does not widen editing permission for a verified cached configuration", () => {
  mock.permission = false; mock.source = "LAST_KNOWN_GOOD"; draw();
  expect(saveButton()).toBeUndefined(); expect(mock.switches.every(switchProps => switchProps.disabled)).toBe(true);
});
it.each(["branch", "permission", "cacheScope", "user"] as const)("does not save or queue after %s changes while credentials are loading", async field => {
  let resolve!: (value: object) => void;
  mock.auth.mockReturnValue(new Promise<object>(done => { resolve = done; }));
  draw(); const pending = (saveButton().onClick as () => Promise<void>)();
  if (field === "branch") mock.branch = "another-branch";
  if (field === "permission") mock.permission = false;
  if (field === "cacheScope") mock.cacheScope = "another-profile";
  if (field === "user") mock.userId = "user-b";
  draw(); resolve({ accessToken: "staff-token" }); await pending;
  await new Promise(done => setTimeout(done, 0));
  expect(mock.queue).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
});
it.each(["permission denied", "Not signed in", "Unexpected data failure"])("does not turn %s into a pending offline change", async message => {
  mock.auth.mockRejectedValue(new Error(message)); draw();
  await (saveButton().onClick as () => Promise<void>)();
  await new Promise(done => setTimeout(done, 0));
  expect(mock.queue).not.toHaveBeenCalled();
});
it("queues a genuine transport failure while the current verified authority is unchanged", async () => {
  mock.auth.mockRejectedValue(new Error("fetch failed")); draw();
  await (saveButton().onClick as () => Promise<void>)();
  await new Promise(done => setTimeout(done, 0));
  expect(mock.queue).toHaveBeenCalledOnce();
});
it("does not queue a second write if a refresh fails after the local save succeeded", async () => {
  mock.refresh.mockRejectedValue(new Error("fetch failed")); draw();
  await (saveButton().onClick as () => Promise<void>)();
  await new Promise(done => setTimeout(done, 0));
  expect(mock.queue).toHaveBeenCalledOnce();
});
