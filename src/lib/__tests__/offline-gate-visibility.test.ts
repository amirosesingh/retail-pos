import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudIssue } from "@/core/activation/connection-health";
import { hasOnlyFiniteEntrance, offlineSnapshotScope, pauseOfflineInteraction, retainOfflineSnapshot } from "../offline-gate-visibility";

const fixture = vi.hoisted(() => ({
  auth: { ready: true,authUserId: "cloud-a",terminalUser: null,
    appUser: { is_active: true },user: { staffId: "person-a",storeId: "a",role: "cashier",
      roles: ["staff"],permissions: { can_complete_payment: true } } },
  pos: { ready: true,currentStore: { id: "a" } },
  scope: vi.fn(),
}));
vi.mock("@/lib/pos-auth",() => ({ useAuth: () => fixture.auth }));
vi.mock("@/lib/pos-store",() => ({ usePos: () => fixture.pos }));
vi.mock("@/lib/session-epoch",() => ({ sessionEpoch: () => 3 }));
vi.mock("@/core/local-db/db-mode",() => ({ subscribeDatabaseMode: () => () => {},effectiveDatabaseMode: () => "online" }));
vi.mock("@/lib/offline-gate-snapshot-context",() => ({ useOfflineGateSnapshot: (value: string | null) => fixture.scope(value) }));
import { OfflineGateSnapshot } from "@/components/shared/OfflineGateSnapshot";

const scope = (patch: Partial<Parameters<typeof offlineSnapshotScope>[0]> = {}) => offlineSnapshotScope({
  authReady: true,dataReady: true,active: true,personId: "cashier-a",branchId: "a",accountBranchId: "a",
  epoch: 1,mode: "online",role: "cashier",roles: ["staff"],permissions: { can_complete_payment: true },...patch,
});
const snapshot = scope();
const retained = (patch: Partial<Parameters<typeof retainOfflineSnapshot>[0]> = {}) => retainOfflineSnapshot({
  web: true,state: "offline",issue: "timeout",currentScope: snapshot,onlineScope: snapshot,...patch,
});

describe("loaded browser snapshot during connection recovery",() => {
  it.each([
    ["enter", "1", true], ["enter, fade", "1, 2", true], ["enter, fade", "1", true],
    ["none", "1", false], ["", "", false], ["spin", "infinite", false],
    ["enter, spin", "1, infinite", false], ["none, spin", "1, infinite", false],
  ])("settles %s (%s) only when every active animation is finite", (name, count, expected) => {
    expect(hasOnlyFiniteEntrance(String(name), String(count))).toBe(expected);
  });
  it.each<CloudIssue>(["device-offline","timeout","service-error","rate-limited","transport"])(
    "keeps only the same already-loaded browser snapshot visible for %s",issue => {
      expect(retained({ issue })).toBe(true);
      expect(retained({ issue,state: "connecting" })).toBe(true);
    });
  it.each<CloudIssue>(["authentication","permission","configuration","none"])(
    "does not retain protected content for %s",issue => {
      expect(retained({ issue })).toBe(false);
    });
  it("does not change native offline, cold-start or unconfirmed-data gates",() => {
    expect(retained({ web: false })).toBe(false);
    expect(retained({ onlineScope: null })).toBe(false);
    expect(retained({ currentScope: null })).toBe(false);
    expect(retained({ state: "online" })).toBe(false);
  });
  it.each([
    { personId: "cashier-b" },{ branchId: "b" },{ accountBranchId: "b" },{ epoch: 2 },{ mode: "local" },
    { role: "supervisor" },{ roles: ["manager"] },{ permissions: { can_complete_payment: false } },
  ])("never displays a previous authority's snapshot after scope changes: %j",patch => {
    expect(retained({ currentScope: scope(patch) })).toBe(false);
  });
  it.each([{ authReady: false },{ dataReady: false },{ active: false },{ personId: null },{ branchId: null },{ branchId: " " }])(
    "requires a loaded matching primary snapshot and current account: %j",patch => {
      expect(scope(patch)).toBeNull();
    });
  it("does not invalidate an unchanged scope due to object ordering or branch UUID casing",() => {
    const first=scope({ branchId: "ABCD",roles: ["manager","staff"],permissions: { first: true,second: false } });
    expect(scope({ branchId: "abcd",roles: ["staff","manager"],permissions: { second: false,first: true } })).toBe(first);
  });
  it("keeps retained content inert and uses a compact status without new probes or reloads",() => {
    const source=readFileSync("src/platforms/mobile/components/OfflineGate.tsx","utf8");
    expect(source).toContain("inert={!available}");
    expect(source).toContain("hidden={!available && !retained}");
    expect(source).toContain("Actions are paused while reconnecting.");
    expect(source).toContain("retained ? <RetainedConnectionStatus /> : <OfflineStatus />");
    expect(source).not.toContain("window.location.reload");
    expect(source).not.toContain("setInterval");
  });
  it("prevents a portaled action's default and propagation without cancelling committed work",async () => {
    const committedResult=Promise.resolve("already saved");
    const defaultAction=vi.fn(),bubbleAction=vi.fn();
    const event={ defaultPrevented: false,propagationStopped: false,
      preventDefault() { this.defaultPrevented=true; },stopPropagation() { this.propagationStopped=true; } };
    pauseOfflineInteraction(event);
    if (!event.defaultPrevented) defaultAction();
    if (!event.propagationStopped) bubbleAction();
    expect(defaultAction).not.toHaveBeenCalled(); expect(bubbleAction).not.toHaveBeenCalled();
    await expect(committedResult).resolves.toBe("already saved");
    const source=readFileSync("src/platforms/mobile/components/OfflineGate.tsx","utf8");
    for (const name of ["Click","DoubleClick","PointerDown","KeyDown","KeyUp","Submit","Change","Input"])
      expect(source).toContain(`on${name}Capture={pauseInteraction}`);
    expect(source).toContain("!isNative() && !available ? pauseOfflineInteraction : undefined");
    expect(source.indexOf("</div>",source.indexOf("onInputCapture={pauseInteraction}")))
      .toBeLessThan(source.indexOf("retained ? <RetainedConnectionStatus />"));
  });
});

describe("read-only readiness bridge under existing auth and POS providers",() => {
  beforeEach(() => {
    fixture.auth.ready=true; fixture.auth.appUser.is_active=true;
    fixture.pos.ready=true; fixture.pos.currentStore.id="a"; fixture.scope.mockClear();
  });
  it("registers an opaque scope only after the primary snapshot is ready",() => {
    expect(renderToStaticMarkup(createElement(OfflineGateSnapshot))).toBe("");
    expect(fixture.scope).toHaveBeenLastCalledWith(expect.any(String));
    fixture.pos.ready=false;
    renderToStaticMarkup(createElement(OfflineGateSnapshot));
    expect(fixture.scope).toHaveBeenLastCalledWith(null);
  });
  it("drops the cached-display scope when authentication or account activation is lost",() => {
    fixture.auth.ready=false; renderToStaticMarkup(createElement(OfflineGateSnapshot));
    expect(fixture.scope).toHaveBeenLastCalledWith(null);
    fixture.auth.ready=true; fixture.auth.appUser.is_active=false;
    renderToStaticMarkup(createElement(OfflineGateSnapshot));
    expect(fixture.scope).toHaveBeenLastCalledWith(null);
  });
  it("invalidates old branch presentation while preserving a read-only bridge",() => {
    renderToStaticMarkup(createElement(OfflineGateSnapshot));
    const oldScope=fixture.scope.mock.calls.at(-1)?.[0];
    fixture.pos.currentStore.id="b";
    renderToStaticMarkup(createElement(OfflineGateSnapshot));
    expect(fixture.scope.mock.calls.at(-1)?.[0]).not.toBe(oldScope);
    const source=readFileSync("src/components/shared/OfflineGateSnapshot.tsx","utf8");
    expect(source).not.toMatch(/\b(fetch|heartbeat|loadPrimaryState|setCurrentStore)\s*\(/);
    const context=readFileSync("src/lib/offline-gate-snapshot-context.ts","utf8");
    expect(context).toContain("useClientLayoutEffect(() => report?.(scope)");
  });
});
