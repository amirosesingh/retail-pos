import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_POS_RULES } from "../pos-rules";

const mock = vi.hoisted(() => ({
  source: "DATABASE", loading: false, usingDefaults: false, notVerified: false,
  permission: true, slots: [] as unknown[], cursor: 0,
  refs: [] as Array<{ current: unknown }>, refCursor: 0, branch: "branch", baselineBranch: "branch", cacheScope: "verified-scope",
  userId: "user-a",
  dirtyField: "prevent_negative_stock_sale" as "prevent_negative_stock_sale" | "block_shift_close_on_hold",
  failure: "none",
  bridge: null as Record<string, unknown> | null,
  buttons: [] as Array<Record<string, unknown>>, switches: [] as Array<Record<string, unknown>>,
  queue: vi.fn(), auth: vi.fn(), refresh: vi.fn(), save: vi.fn(), fetch: vi.fn(), toastError: vi.fn(), notify: vi.fn(),
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
      ? { ...(initial as typeof DEFAULT_POS_RULES), [mock.dirtyField]: !(initial as typeof DEFAULT_POS_RULES)[mock.dirtyField] }
      : initial;
    return [mock.slots[index], (next: unknown) => { mock.slots[index] = next; }];
  },
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/lib/pos-rules.tsx", () => ({ usePosRules: () => ({
  rules: DEFAULT_POS_RULES, source: mock.source, loading: mock.loading,
  usingDefaults: mock.usingDefaults, notVerified: mock.notVerified,
  failureText: mock.notVerified ? "Unavailable" : "", status: mock.notVerified ? "NOT_VERIFIED" : "DEGRADED",
  failure: mock.failure,
  refresh: mock.refresh, confirmSaved: vi.fn(), branchId: mock.baselineBranch, terminalId: "terminal", rowVersion: 7,
  cacheScope: mock.cacheScope,
  shiftSharingAvailable: true,
}) }));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({ isAdmin: false, user: { staffId: mock.userId }, authUserId: mock.userId, terminalUser: null, can: () => mock.permission }) }));
vi.mock("@/lib/pos-store", () => ({ usePos: () => ({ currentStore: { id: mock.branch, name: "Branch" } }) }));
vi.mock("@/lib/pos-caller-auth", () => ({ getPosCallerAuth: mock.auth }));
vi.mock("@/lib/pos-rules-client", () => ({ savePosRules: mock.save }));
vi.mock("@/lib/server-origin", () => ({ serverOrigin: () => "", posFetch: mock.fetch }));
vi.mock("@/lib/pos-rules-offline", () => ({ queueRulesSave: mock.queue }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => mock.bridge }));
vi.mock("@/platform-config/features", () => ({ isWindowsShell: () => true }));
vi.mock("@/lib/idle-timeout-client", () => ({ requestIdleTimeout: vi.fn() }));
vi.mock("@/lib/sync-engine", () => ({ broadcastSettingsChange: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyError: mock.notify }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mock.toastError } }));
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
const clickSave = async () => {
  (saveButton().onClick as () => void)();
  await vi.waitFor(() => expect(mock.slots[1]).toBe(false));
};
const readyLocalState = { enabled: true, connected: true, configured: true, tradingReady: true };
const nativeSettings = (queueStoreSettingsEdit: unknown, state: unknown = readyLocalState) => {
  const bridge = { queueStoreSettingsEdit, database: { getState: vi.fn(async () => state) } };
  mock.bridge = bridge;
  vi.stubGlobal("window", { pos: bridge });
  return bridge;
};
beforeEach(() => {
  mock.source = "DATABASE"; mock.loading = false; mock.usingDefaults = false; mock.notVerified = false; mock.permission = true;
  mock.slots = []; mock.refs = []; mock.branch = "branch"; mock.baselineBranch = "branch"; mock.cacheScope = "verified-scope";
  mock.userId = "user-a";
  mock.dirtyField = "prevent_negative_stock_sale"; mock.failure = "none";
  mock.bridge = null;
  mock.auth.mockReset().mockResolvedValue({}); mock.queue.mockReset().mockResolvedValue(undefined);
  mock.refresh.mockReset().mockResolvedValue(undefined); mock.save.mockReset(); mock.fetch.mockReset();
  mock.toastError.mockReset(); mock.notify.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it.each(["DEFAULT_SAFETY", "UNAVAILABLE", "LEGACY_CACHE"])("does not edit or save unverified %s defaults, even through a stale callback", async source => {
  mock.source = source; mock.usingDefaults = source !== "LEGACY_CACHE"; mock.notVerified = source !== "LEGACY_CACHE";
  draw();
  expect(saveButton().disabled).toBe(true);
  expect(mock.switches.length).toBeGreaterThan(0);
  expect(mock.switches.every(switchProps => switchProps.disabled)).toBe(true);
  const before = mock.slots[0];
  (mock.switches[0].onCheckedChange as (value: boolean) => void)(true);
  expect(mock.slots[0]).toBe(before);
  await clickSave();
  expect(mock.auth).not.toHaveBeenCalled(); expect(mock.queue).not.toHaveBeenCalled();
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
});
it.each(["DATABASE", "LAST_KNOWN_GOOD"])("keeps the verified %s draft when a connection is required to save", async source => {
  mock.source = source;
  draw();
  expect(saveButton().disabled).toBe(false);
  expect(mock.switches.some(switchProps => !switchProps.disabled)).toBe(true);
  await clickSave();
  expect(mock.queue).not.toHaveBeenCalled();
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.toastError).toHaveBeenCalledWith(expect.stringContaining("Your draft is still open"));
});
it("keeps existing pending rules and refuses a new save based on their unconfirmed revision", async () => {
  mock.source = "LOCAL_PENDING";
  draw();
  expect(mock.switches.some(switchProps => !switchProps.disabled)).toBe(true);
  await clickSave();
  expect(mock.queue).not.toHaveBeenCalled();
  expect(mock.auth).not.toHaveBeenCalled();
  expect(mock.toastError).toHaveBeenCalledWith(expect.stringContaining("pending rules to be confirmed"));
});
it("reuses one offline settings command ID across uncertain IPC responses without sending a legacy write", async () => {
  const queueStoreSettingsEdit = vi.fn()
    .mockRejectedValueOnce(new Error("fixture IPC response lost"))
    .mockImplementation(async ({ operationId }: { operationId: string }) => ({ ok: true, operationId }));
  nativeSettings(queueStoreSettingsEdit);
  mock.source = "LAST_KNOWN_GOOD"; mock.failure = "network"; mock.dirtyField = "block_shift_close_on_hold";
  draw();
  await clickSave();
  draw();
  await clickSave();
  expect(queueStoreSettingsEdit.mock.calls).toEqual([[{
    branchId: "branch", expectedVersion: 7, operationId: expect.any(String),
    patch: { block_shift_close_on_hold: !DEFAULT_POS_RULES.block_shift_close_on_hold },
  }], [queueStoreSettingsEdit.mock.calls[0][0]]]);
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.queue).not.toHaveBeenCalled();
});
it("queues both supported rule fields locally while online, retaining exact drawer money and the verified revision", async () => {
  const queue = vi.fn(async ({ operationId }: { operationId: string }) => ({ ok: true, operationId }));
  nativeSettings(queue); vi.stubGlobal("navigator", { onLine: true });
  mock.dirtyField = "block_shift_close_on_hold"; mock.slots[8] = "9007199254740993.125000000002";
  draw(); await clickSave();
  expect(queue).toHaveBeenCalledExactlyOnceWith({ branchId: "branch", expectedVersion: 7, operationId: expect.any(String),
    patch: { block_shift_close_on_hold: !DEFAULT_POS_RULES.block_shift_close_on_hold, max_drawer_cash_limit: "9007199254740993.125000000002" } });
  expect(mock.auth).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
});
it.each(["rejected", "unconfirmed"])("keeps a %s native save from falling through to head office", async failure => {
  const queue = failure === "rejected" ? vi.fn().mockRejectedValue(new Error("Local SQL save failed"))
    : vi.fn().mockResolvedValue({ ok: false, error: "Local save remains pending" });
  nativeSettings(queue); mock.dirtyField = "block_shift_close_on_hold";
  draw(); const draft = mock.slots[0]; await clickSave();
  expect(mock.slots[0]).toBe(draft); expect(queue).toHaveBeenCalledOnce();
  expect(mock.auth).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
});
it.each([
  { enabled: true, connected: false, configured: true },
  { enabled: true, connected: true, configured: true, tradingReady: false },
  { enabled: true, connected: true, localRecoveryPending: true },
  null,
])("keeps unreadable or unavailable native readiness from becoming hosted-save permission (%j)", async state => {
  const queue = vi.fn(); nativeSettings(queue, state); mock.dirtyField = "block_shift_close_on_hold";
  draw(); await clickSave();
  expect(mock.notify).toHaveBeenCalledWith(expect.objectContaining({ code: expect.stringMatching(/^ELOCAL_/) }), "Could not save rules");
  expect(queue).not.toHaveBeenCalled(); expect(mock.auth).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
});
it("does not bypass a missing native writer when SQL is ready", async () => {
  nativeSettings(undefined); mock.dirtyField = "block_shift_close_on_hold";
  draw(); await clickSave();
  expect(mock.notify).toHaveBeenCalledWith(expect.objectContaining({ code: "ELOCAL_NOT_READY" }), "Could not save rules");
  expect(mock.auth).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
});
it("retains the authorized central workflow for unsupported online native edits and explains the save target beforehand", async () => {
  const queue = vi.fn(); nativeSettings(queue); vi.stubGlobal("navigator", { onLine: true });
  mock.auth.mockResolvedValue({ accessToken: "staff-token" }); mock.save.mockResolvedValue({ ok: true });
  expect(draw()).toContain("They save centrally and then download to this till");
  await clickSave();
  expect(mock.save).toHaveBeenCalledOnce(); expect(queue).not.toHaveBeenCalled();
});
it("keeps unsupported native edits open offline without widening the two-field command", async () => {
  const queue = vi.fn(); nativeSettings(queue); vi.stubGlobal("navigator", { onLine: false });
  draw(); await clickSave();
  expect(mock.toastError).toHaveBeenCalledWith(expect.stringContaining("head office"));
  expect(queue).not.toHaveBeenCalled(); expect(mock.auth).not.toHaveBeenCalled();
});
it("retains the existing central path when the native database is explicitly disabled", async () => {
  const queue = vi.fn(); nativeSettings(queue, { enabled: false, connected: false }); mock.dirtyField = "block_shift_close_on_hold";
  mock.auth.mockResolvedValue({ accessToken: "staff-token" }); mock.save.mockResolvedValue({ ok: true });
  draw(); await clickSave();
  expect(queue).not.toHaveBeenCalled(); expect(mock.save).toHaveBeenCalledOnce();
});
it("does not queue after a branch change while native readiness is being checked", async () => {
  const queue = vi.fn(), bridge = nativeSettings(queue);
  let resolve!: (state: typeof readyLocalState) => void;
  bridge.database.getState.mockReturnValue(new Promise(done => { resolve = done; }));
  mock.dirtyField = "block_shift_close_on_hold"; draw(); const pending = clickSave();
  mock.branch = "another-branch"; draw(); resolve(readyLocalState); await pending;
  expect(queue).not.toHaveBeenCalled(); expect(mock.auth).not.toHaveBeenCalled();
  expect(mock.notify).toHaveBeenCalledWith(expect.objectContaining({ code: "RULES_CONTEXT_CHANGED" }), "Could not save rules");
});
it("does not duplicate an uncertain central save through the local queue after reconnect", async () => {
  mock.dirtyField = "block_shift_close_on_hold"; mock.auth.mockResolvedValue({ accessToken: "staff-token" });
  mock.save.mockRejectedValue(new Error("fetch failed")); draw(); await clickSave();
  const queue = vi.fn(); nativeSettings(queue); draw(); await clickSave();
  expect(queue).not.toHaveBeenCalled(); expect(mock.save).toHaveBeenCalledOnce();
  expect(mock.toastError).toHaveBeenLastCalledWith(expect.stringContaining("earlier online save could not be confirmed"));
});
it("shows an exact stale settings comparison and confirms keep-central separately from saving", async () => {
  const decisionSha256 = "f".repeat(64);
  const reviewStoreSettingsEdit = vi.fn()
    .mockResolvedValueOnce({ ok: true, review: { operationId: "saved-operation", decisionSha256,
      expectedVersion: 7, currentVersion: 8,
      proposedValues: { max_drawer_cash_limit: "10000000000000.123456789123" },
      currentValues: { max_drawer_cash_limit: "10000000000000.123456789124" } } })
    .mockResolvedValueOnce({ ok: true, operationId: "saved-operation" });
  vi.stubGlobal("window", { pos: { reviewStoreSettingsEdit } });
  mock.slots[9] = { status: "REVIEW_REQUIRED", branchId: "branch" };
  const button = (label: string) => mock.buttons.find(item => item.children === label)!;
  draw();
  expect(saveButton().disabled).toBe(true);
  (button("Review saved settings edit").onClick as () => void)();
  await vi.waitFor(() => expect(draw()).toContain("10000000000000.123456789123"));
  expect(draw()).toContain("10000000000000.123456789124");
  expect(reviewStoreSettingsEdit.mock.calls).toEqual([[{ action: "preview", branchId: "branch" }]]);
  (button("Keep central rules").onClick as () => void)();
  await vi.waitFor(() => expect(draw()).not.toContain("Keep central rules"));
  expect(reviewStoreSettingsEdit.mock.calls.at(-1)).toEqual([{
    action: "keep-central", branchId: "branch", operationId: "saved-operation", decisionSha256,
  }]);
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.fetch).not.toHaveBeenCalled();
  expect(saveButton().disabled).toBe(false);
});
it("requires a verified revision for the selected store before submitting", async () => {
  mock.branch = "another-branch";
  draw();
  expect(saveButton().disabled).toBe(true);
  await clickSave();
  expect(mock.auth).not.toHaveBeenCalled();
});
it("accepts a case-equivalent selected store UUID", () => {
  mock.branch = "00000000-0000-4000-8000-00000000000A";
  mock.baselineBranch = mock.branch.toLowerCase();
  draw();
  expect(saveButton().disabled).toBe(false);
});
it("holds edits while the first rules read is loading", async () => {
  mock.loading = true; draw(); expect(saveButton().disabled).toBe(true);
  await clickSave();
  expect(mock.auth).not.toHaveBeenCalled();
});
it("does not widen editing permission for a verified cached configuration", () => {
  mock.permission = false; mock.source = "LAST_KNOWN_GOOD"; draw();
  expect(saveButton()).toBeUndefined(); expect(mock.switches.every(switchProps => switchProps.disabled)).toBe(true);
});
it.each(["branch", "permission", "cacheScope", "user"] as const)("does not save or queue after %s changes while credentials are loading", async field => {
  let resolve!: (value: object) => void;
  mock.auth.mockReturnValue(new Promise<object>(done => { resolve = done; }));
  draw(); const pending = clickSave();
  await vi.waitFor(() => expect(mock.auth).toHaveBeenCalledOnce());
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
  await clickSave();
  await new Promise(done => setTimeout(done, 0));
  expect(mock.queue).not.toHaveBeenCalled();
});
it("keeps a failed transport from falling through to the generic settings writer", async () => {
  mock.auth.mockRejectedValue(new Error("fetch failed")); draw();
  await clickSave();
  await new Promise(done => setTimeout(done, 0));
  expect(mock.queue).not.toHaveBeenCalled();
  expect(mock.toastError).toHaveBeenCalledWith(expect.stringContaining("could not be confirmed"));
});
it("does not queue a second write if a refresh fails after the canonical save succeeded", async () => {
  mock.auth.mockResolvedValue({ accessToken: "staff-token" });
  mock.save.mockResolvedValue({ ok: true });
  mock.refresh.mockRejectedValue(new Error("fetch failed")); draw();
  await clickSave();
  await new Promise(done => setTimeout(done, 0));
  expect(mock.save).toHaveBeenCalledOnce();
  expect(mock.queue).not.toHaveBeenCalled();
});
