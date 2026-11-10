import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PairingRequest, TerminalConfig } from "@/core/activation/terminal-tokens";

const f = vi.hoisted(() => ({
  cursor: 0,
  slots: new Map<number, unknown>(),
  deps: new Map<number, readonly unknown[] | undefined>(),
  cleanups: new Map<number, () => void>(),
  effects: [] as (() => void)[],
  activate: vi.fn<(code: string) => Promise<TerminalConfig>>(),
  pair: vi.fn<(request: PairingRequest, onApproved?: () => void) => Promise<TerminalConfig | null>>(),
  pairingRequest: vi.fn<() => Promise<PairingRequest>>(),
  writeRecord: vi.fn(),
  clearRevocation: vi.fn(),
  cloudOnline: vi.fn(() => false),
}));

vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  function changed(index: number, deps?: readonly unknown[]) {
    const previous = f.deps.get(index);
    f.deps.set(index, deps);
    return !deps || !previous || deps.length !== previous.length || deps.some((v, i) => !Object.is(v, previous[i]));
  }
  function memorize<T>(compute: () => T, deps: readonly unknown[]): T {
    const index = f.cursor++;
    if (changed(index, deps)) f.slots.set(index, compute());
    return f.slots.get(index) as T;
  }
  return { ...actual,
    useState(initial: unknown) {
      const index = f.cursor++;
      if (!f.slots.has(index)) f.slots.set(index, typeof initial === "function" ? initial() : initial);
      return [f.slots.get(index), (next: unknown) => {
        f.slots.set(index, typeof next === "function" ? next(f.slots.get(index)) : next);
      }];
    },
    useRef(initial: unknown) {
      const index = f.cursor++;
      if (!f.slots.has(index)) f.slots.set(index, { current: initial });
      return f.slots.get(index);
    },
    useEffect(effect: () => (() => void) | void, deps?: readonly unknown[]) {
      const index = f.cursor++;
      if (changed(index, deps)) f.effects.push(() => {
        f.cleanups.get(index)?.();
        const cleanup = effect();
        if (cleanup) f.cleanups.set(index, cleanup);
        else f.cleanups.delete(index);
      });
    },
    useMemo: memorize,
    useCallback: <T,>(callback: T, deps: readonly unknown[]) => memorize(() => callback, deps),
  };
});
vi.mock("@/core/activation/terminal-tokens", () => ({
  activateTerminal: f.activate,
  activateWithTokenId: f.pair,
  clearPairingRequest: vi.fn(),
  encodePairingRequest: () => "fixture",
  getPairingRequest: f.pairingRequest,
  readTerminalConfig: () => null,
  isRetryableActivationError: (error: unknown) => error instanceof TypeError,
  ActivationError: class extends Error {
    constructor(message: string, readonly retryable = false) { super(message); }
  },
}));
vi.mock("@/core/activation/registration-status", () => ({ isCloudConnected: f.cloudOnline }));
vi.mock("@/core/activation/connection-health", () => ({ subscribeConnectivity: () => () => {} }));
vi.mock("@/core/activation/activation-record", () => ({ writeActivationRecord: f.writeRecord }));
vi.mock("@/lib/use-revocation-check", () => ({ clearRevocation: f.clearRevocation }));
vi.mock("@/lib/branding", () => ({ useBranding: () => ({ company: "Company", terminal: "Till" }) }));
vi.mock("@/platform-config/platform", () => ({ isNative: () => false }));
vi.mock("@/platform-config/clipboard", () => ({ readText: vi.fn() }));
vi.mock("@/lib/server-origin", () => ({ serverOrigin: () => "https://pos.example.test" }));
vi.mock("@/platforms/web/components/pos/CameraScanner", () => ({ CameraScanner: () => null }));
vi.mock("@/components/shared/EmergencyAccessLink", () => ({ EmergencyAccessLink: () => null }));
vi.mock("@/components/shared/TerminalRegistrationDetails", () => ({ TerminalRegistrationDetails: () => null }));

import { ActivationError } from "@/core/activation/terminal-tokens";
import { TerminalActivation } from "@/platforms/web/components/pos/TerminalActivation";

const request: PairingRequest = { tokenId: "fixture", deviceName: "Counter", proofHash: "a".repeat(64) };
const config: TerminalConfig = {
  tokenId: request.tokenId, deviceName: request.deviceName, locationId: "A", locationName: "Branch A",
  supabaseUrl: "https://db.example.test", supabaseKey: "fixture", activatedAt: "2026-11-10T00:00:00Z",
};
type Element = ReactElement<Record<string, unknown>>;
function find(node: unknown, match: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = find(child, match); if (found) return found; }
  } else if (isValidElement<Record<string, unknown>>(node)) {
    return match(node) ? node : find(node.props.children, match);
  }
}
function copy(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(copy).join("");
  return isValidElement<Record<string, unknown>>(node) ? copy(node.props.children) : "";
}
const onActivated = vi.fn();
function draw() {
  f.cursor = 0;
  const tree = TerminalActivation({ embedded: true, onActivated });
  f.effects.splice(0).forEach(effect => effect());
  return tree;
}
function control(tree: Element, label: string) {
  return find(tree, element => typeof element.props.onClick === "function" && copy(element).trim() === label)!;
}
function click(element: Element) { (element.props.onClick as () => void)(); }
function enterCode(tree: Element, code: string) {
  const field = find(tree, element => element.props.id === "activation-code")!;
  (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: code } });
}
function alert(tree: Element) { return copy(find(tree, element => element.props.role === "alert")); }
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.resetAllMocks();
  f.cursor = 0;
  f.slots.clear();
  f.deps.clear();
  f.cleanups.clear();
  f.effects.length = 0;
  f.cloudOnline.mockReturnValue(false);
  f.pairingRequest.mockResolvedValue(request);
  f.writeRecord.mockResolvedValue(undefined);
});

afterEach(() => {
  f.cleanups.forEach(cleanup => cleanup());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("terminal activation in Emergency Access", () => {
  it.each(["pasted", "scanned"])("checks a %s token despite stale connectivity and displays the actual refusal", async source => {
    f.activate.mockRejectedValueOnce(new ActivationError("This activation code has expired."));
    if (source === "pasted") {
      enterCode(draw(), "  ENC_V1:fixture  ");
      const button = control(draw(), "Activate terminal");
      expect(button.props.disabled).toBe(false);
      click(button);
    } else {
      click(control(draw(), "Scan the activation QR code"));
      const scanner = find(draw(), element => typeof element.props.onScan === "function")!;
      (scanner.props.onScan as (code: string) => void)("  ENC_V1:fixture  ");
    }
    expect(control(draw(), "Activate terminal").props.disabled).toBe(true);
    await settle();
    expect(f.activate).toHaveBeenCalledExactlyOnceWith("ENC_V1:fixture");
    const refused = draw();
    expect(alert(refused)).toBe("This activation code has expired.");
    expect(control(refused, "Activate terminal").props.disabled).toBe(false);
    expect(onActivated).not.toHaveBeenCalled();
  });

  it("polls hosted pairing, reports a retryable error and waits for local registration after approval", async () => {
    f.pair.mockRejectedValueOnce(new ActivationError("Cannot reach the POS website.", true));
    let register!: (value: TerminalConfig) => void;
    f.pair.mockImplementationOnce((_request, approved) => {
      approved?.();
      return new Promise(resolve => { register = resolve; });
    });
    draw();
    await settle();
    click(control(draw(), "Pair from the phone app"));
    draw();
    await settle();
    expect(f.pair).toHaveBeenCalledTimes(1);
    expect(alert(draw())).toBe("Cannot reach the POS website.");
    await vi.advanceTimersByTimeAsync(3_999);
    expect(f.pair).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.pair).toHaveBeenCalledTimes(2);
    expect(copy(draw())).toContain("Approved. Finishing registration on this device…");
    expect(f.writeRecord).not.toHaveBeenCalled();
    register(config);
    await settle();
    expect(f.writeRecord).toHaveBeenCalledExactlyOnceWith({ tokenId: request.tokenId });
    click(control(draw(), "Continue"));
    expect(onActivated).toHaveBeenCalledExactlyOnceWith(config);
  });
});
