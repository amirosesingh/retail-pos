import { createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalConfig } from "@/core/activation/terminal-tokens";

const f = vi.hoisted(() => ({
  search: {} as { section?: "activation" | "connection" },
  profile: { loading: false, error: false, cloud: true as boolean | null, config: null as TerminalConfig | null, retry: vi.fn() },
  activation: vi.fn(), cloud: vi.fn(),
  shallow: false, cursor: 0, state: [] as unknown[], effectDeps: undefined as readonly unknown[] | undefined,
  pending: [] as (() => void)[],
}));

vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual,
    useState(initial: unknown) {
      if (!f.shallow) return actual.useState(initial);
      const index = f.cursor++;
      if (!(index in f.state)) f.state[index] = typeof initial === "function" ? initial() : initial;
      return [f.state[index], (next: unknown) => { f.state[index] = typeof next === "function" ? next(f.state[index]) : next; }];
    },
    useEffect(effect: () => void, deps?: readonly unknown[]) {
      if (!f.shallow) return actual.useEffect(effect, deps);
      if (!f.effectDeps || !deps || deps.some((value, index) => !Object.is(value, f.effectDeps?.[index]))) {
        f.effectDeps = deps;
        f.pending.push(effect);
      }
    },
  };
});
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => f.search }),
  useNavigate: () => vi.fn(),
  Navigate: ({ to }: { to: string }) => createElement("span", { "data-redirect": to }),
}));
vi.mock("../use-recovery-profile", () => ({ useRecoveryProfile: () => f.profile }));
vi.mock("@/core/activation/registration-status", () => ({ useStartupGate: () => ({ loading: true }), emergencyMode: () => "offline-registered" }));
vi.mock("@/core/activation/connection-health", () => ({ heartbeat: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ logger: { log: vi.fn() } }));
vi.mock("@/lib/emergency-pin", () => ({ EMERGENCY_CODE_LENGTH: 6, emergencyPinAvailable: async () => true, verifyEmergencyPin: vi.fn() }));
vi.mock("@/lib/pin-lockout", () => ({ lockoutRemaining: () => 0, notePinFailure: () => 0, attemptsLeft: () => 5, clearPinFailures: vi.fn() }));
vi.mock("@/platforms/web/components/pos/TerminalActivation", () => ({ TerminalActivation: () => {
  f.activation(); return createElement("div", { "data-activation-editor": true }, "Activation editor");
} }));
vi.mock("@/platforms/web/components/pos/settings/panels/CloudConnectionPanel", () => ({ CloudConnectionPanel: () => {
  f.cloud(); return createElement("div", { "data-connection-editor": true }, "Connection editor");
} }));
vi.mock("@/platforms/web/components/pos/ReceiptPrinterSettings", () => ({ RecoveryPrinterSettings: () => createElement("div", null, "Hardware controls") }));

import { Route } from "@/routes/recovery";
import { RecoveryHub } from "@/platforms/web/components/pos/RecoveryHub";
import { recoverySearch } from "../recovery-section";

const saved: TerminalConfig = { tokenId: "saved-terminal", deviceName: "Counter A", deviceUse: "operations", locationId: "A", locationName: "Branch A",
  backendUrl: "https://user:private-password@pos.example.test/path?secret=private-query", supabaseUrl: "https://db.example.test/rest?key=private-key",
  supabaseKey: "private-cloud-key", deviceClaimProof: "private-replica-proof", activatedAt: "2026-10-31T00:00:00Z",
};
const renderHub = (section?: "activation" | "connection") => renderToStaticMarkup(createElement<{ section?: "activation" | "connection" }>(RecoveryHub, { section }));
const renderRoute = () => renderToStaticMarkup(createElement(Route.options.component as ComponentType));
function platform(name: "android" | "ios" | "electron" | "web") {
  vi.stubGlobal("window", name === "electron" ? { pos: {} } : name === "web" ? {} : {
    Capacitor: { isNativePlatform: () => true, getPlatform: () => name },
  });
}
beforeEach(() => {
  platform("android"); f.search = {};
  f.profile = { loading: false, error: false, cloud: true, config: saved, retry: vi.fn() };
  f.activation.mockClear(); f.cloud.mockClear();
  f.shallow = false; f.cursor = 0; f.state = []; f.effectDeps = undefined; f.pending = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("terminal setup uses protected recovery with presentation-only sections", () => {
  it.each(["android", "ios", "electron"] as const)("keeps %s section deep links behind the existing recovery gate", name => {
    platform(name); f.search = { section: "connection" };
    const html = renderRoute();
    expect(html).toContain("Emergency access");
    expect(html).not.toContain("Connection editor");
    expect(html).not.toContain("saved-terminal");
    expect(f.cloud).not.toHaveBeenCalled(); expect(f.activation).not.toHaveBeenCalled();
  });
  it("redirects ordinary browsers without mounting native setup", () => {
    platform("web"); f.search = { section: "activation" };
    expect(renderRoute()).toContain('data-redirect="/"');
    expect(f.cloud).not.toHaveBeenCalled(); expect(f.activation).not.toHaveBeenCalled();
  });
  it("accepts only the two supported presentation hints", () => {
    for (const section of ["activation", "connection"] as const) expect(recoverySearch({ section })).toEqual({ section });
    for (const section of ["database", "admin", ["activation"], { section: "activation" }, null]) expect(recoverySearch({ section, unlocked: true })).toEqual({});
  });
  it.each(["activation", "connection"] as const)("keeps a pending or failed %s profile out of configuration editors", section => {
    for (const state of [{ loading: true, error: false }, { loading: false, error: true }]) {
      Object.assign(f.profile, state, { config: null, cloud: null });
      const html = renderHub(section);
      expect(html).not.toContain("Not activated"); expect(html).not.toContain(">Missing<");
      expect(html).not.toContain("Activation editor"); expect(html).not.toContain("Connection editor");
    }
    expect(f.cloud).not.toHaveBeenCalled(); expect(f.activation).not.toHaveBeenCalled();
  });
  it("opens connection repair without mounting activation on a saved terminal", () => {
    expect(renderHub("connection")).toContain("Connection editor");
    expect(f.cloud).toHaveBeenCalledOnce(); expect(f.activation).not.toHaveBeenCalled();
  });
  it("shows saved registration and safe origins before offering activation changes", () => {
    const html = renderHub("activation");
    for (const value of ["saved-terminal", "Counter A", "Branch A", "https://pos.example.test", "https://db.example.test", "Review activation options"]) expect(html).toContain(value);
    for (const value of ["private-password", "private-query", "private-key", "private-cloud-key", "private-replica-proof"]) expect(html).not.toContain(value);
    expect(f.activation).not.toHaveBeenCalled(); expect(f.cloud).not.toHaveBeenCalled();
  });
  it("identifies an unbound Management terminal without calling it unregistered or branchless", () => {
    f.profile.config = { ...saved, deviceUse: "management", locationId: "", locationName: "" };
    const html = renderHub("activation");
    expect(html).toContain("Saved registration"); expect(html).toContain("Management");
    expect(html).not.toContain("Not bound"); expect(html).not.toContain("Not activated");
    expect(f.activation).not.toHaveBeenCalled();
  });
});

type CardProps = { title: string; defaultOpen?: boolean; children: ReactNode };
function activationCard() {
  return (RecoveryHub({}).props.children as ReactNode[]).find(child => isValidElement<CardProps>(child) && child.props.title === "Terminal activation") as ReactElement<CardProps>;
}
function renderCard(card: ReactElement<CardProps>) {
  f.shallow = true; f.cursor = 0;
  return (card.type as (props: CardProps) => ReactElement<{ children: ReactElement<{ "aria-expanded": boolean; onClick: () => void }>[] }>)(card.props);
}
it("opens an asynchronously missing activation card once and lets the operator collapse it", () => {
  Object.assign(f.profile, { loading: true, config: null, cloud: null });
  const pending = renderCard(activationCard()); f.pending.splice(0).forEach(effect => effect());
  expect(pending.props.children[0].props["aria-expanded"]).toBe(false);
  Object.assign(f.profile, { loading: false, cloud: true });
  renderCard(activationCard()); f.pending.splice(0).forEach(effect => effect());
  const open = renderCard(activationCard());
  expect(open.props.children[0].props["aria-expanded"]).toBe(true);
  open.props.children[0].props.onClick();
  const collapsed = renderCard(activationCard()); f.pending.splice(0).forEach(effect => effect());
  expect(collapsed.props.children[0].props["aria-expanded"]).toBe(false);
});
