import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TerminalConfig } from "@/core/activation/terminal-tokens";

const f = vi.hoisted(() => ({
  profile: { loading: false, error: true, connectionReady: true, registrationReady: false, registrationCode: "EACTIVATION_RECOVERY_BINDING" as string | null,
    registrationMessage: "The saved registration could not be matched to the previous terminal binding.", config: null as TerminalConfig | null, cloud: true, retry: vi.fn() },
  cursor: 0, slots: [] as unknown[], deps: new Map<number, readonly unknown[]>(), effects: [] as (() => void)[], cleanups: new Map<number, () => void>(),
  status: vi.fn(), connect: vi.fn(), online: vi.fn(), evidence: vi.fn(() => ({ sealed: "sealed-fixture", plain: null, key: "key-fixture" })),
}));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual,
    useState(initial: unknown) {
      const index = f.cursor++;
      if (!(index in f.slots)) f.slots[index] = typeof initial === "function" ? initial() : initial;
      return [f.slots[index], (next: unknown) => { f.slots[index] = typeof next === "function" ? next(f.slots[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = f.cursor++;
      if (!(index in f.slots)) f.slots[index] = { current: initial };
      return f.slots[index];
    },
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const index = f.cursor++;
      const previous = f.deps.get(index);
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
        f.deps.set(index, deps); f.effects.push(() => {
          f.cleanups.get(index)?.();
          const cleanup = effect();
          if (cleanup) f.cleanups.set(index, cleanup); else f.cleanups.delete(index);
        });
      }
    },
    useCallback: <T,>(callback: T) => callback,
  };
});
vi.mock("@/lib/use-recovery-profile", () => ({ useRecoveryProfile: () => f.profile }));
vi.mock("@/platform-config/platform", () => ({ isTerminalApp: () => true }));
vi.mock("@/core/activation/terminal-tokens", () => ({ ActivationError: class extends Error {}, retainedTerminalRecoveryEvidence: f.evidence }));
vi.mock("@/platforms/web/components/pos/settings/panels/CloudConnectionPanel", () => ({ CloudConnectionPanel: () => null }));
vi.mock("@/platforms/web/components/pos/TerminalActivation", () => ({ TerminalActivation: () => null }));
vi.mock("@/platforms/web/components/pos/ReceiptPrinterSettings", () => ({ RecoveryPrinterSettings: () => null }));
vi.mock("@/components/shared/TerminalRegistrationDetails", () => ({ TerminalRegistrationDetails: () => null }));
vi.mock("@/core/activation/registration-status", () => ({ useStartupGate: () => ({ loading: true }), emergencyMode: () => "offline-registered" }));
import { RecoveryHub } from "@/platforms/web/components/pos/RecoveryHub";
import { TerminalActivation } from "@/platforms/web/components/pos/TerminalActivation";

type Element = ReactElement<Record<string, unknown>>;
function find(node: unknown, match: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = find(child, match); if (found) return found; }
  } else if (isValidElement<Record<string, unknown>>(node)) return match(node) ? node : find(node.props.children, match);
}
function copy(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(copy).join("");
  return isValidElement<Record<string, unknown>>(node) ? copy(node.props.children) : "";
}
function draw() {
  const card = find(RecoveryHub({}), element => element.props.title === "Terminal activation")!;
  const settings = card.props.children as Element;
  f.cursor = 0;
  const tree = (settings.type as (props: Record<string, unknown>) => Element)(settings.props);
  f.effects.splice(0).forEach(effect => effect());
  return tree;
}
const button = (tree: Element, text: string) => find(tree, element => typeof element.props.onClick === "function" && copy(element) === text);
const click = (element: Element | undefined) => { expect(element).toBeDefined(); (element!.props.onClick as () => void)(); };
const editor = (tree: Element) => find(tree, element => element.type === TerminalActivation);
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const chooseRepair = () => click(button(draw(), "Repair or re-register terminal"));
const checkRepair = async () => { click(button(draw(), "Check before re-registering")); await settle(); };

beforeEach(() => {
  vi.resetAllMocks(); f.cursor = 0; f.slots = []; f.deps.clear(); f.effects = []; f.cleanups.clear();
  Object.assign(f.profile, { loading: false, error: true, connectionReady: true, registrationReady: false, registrationCode: "EACTIVATION_RECOVERY_BINDING", config: null });
  f.evidence.mockReturnValue({ sealed: "sealed-fixture", plain: null, key: "key-fixture" });
  vi.stubGlobal("window", { pos: { terminalRepairStatus: f.status, terminalRepairConnectDatabase: f.connect, terminalRepairContinueOnline: f.online }, location: { assign: vi.fn() } });
});
afterEach(() => { f.cleanups.forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });

it("requires explicit repair review and a completed native preflight before mounting activation", async () => {
  let resolve!: (value: unknown) => void;
  f.status.mockReturnValue(new Promise(next => { resolve = next; }));
  expect(editor(draw())).toBeUndefined(); expect(f.status).not.toHaveBeenCalled();
  chooseRepair();
  expect(copy(draw())).toContain("saved setup is kept"); expect(editor(draw())).toBeUndefined();
  click(button(draw(), "Check before re-registering"));
  expect(copy(draw())).toContain("Checking previous setup"); expect(editor(draw())).toBeUndefined();
  resolve({ ok: true, ready: true }); await settle();
  expect(editor(draw())).toBeDefined(); expect(f.status).toHaveBeenCalledOnce();
});

it("connects only the saved previous database through the dedicated native action, then rechecks its work", async () => {
  f.status.mockResolvedValue({ ok: false, code: "EACTIVATION_REPAIR_DATABASE", requiresLocalDatabase: true, error: "private connection material" });
  f.connect.mockResolvedValue({ ok: true, ready: true });
  chooseRepair(); await checkRepair();
  const blocked = draw();
  expect(editor(blocked)).toBeUndefined(); expect(copy(blocked)).not.toContain("private connection material");
  click(button(blocked, "Connect saved local database")); await settle();
  expect(f.connect).toHaveBeenCalledExactlyOnceWith(); expect(editor(draw())).toBeDefined();
});

it("requires an explicit online choice and native preservation before opening replacement activation", async () => {
  f.status.mockResolvedValue({ ok: false, code: "EACTIVATION_REPAIR_DATABASE_UNKNOWN" });
  let resolve!: (value: unknown) => void;
  f.online.mockReturnValue(new Promise(done => { resolve = done; }));
  chooseRepair(); await checkRepair();
  expect(editor(draw())).toBeUndefined(); expect(f.online).not.toHaveBeenCalled(); expect(f.evidence).not.toHaveBeenCalled();
  click(button(draw(), "Continue online and re-register"));
  expect(f.online).toHaveBeenCalledExactlyOnceWith({ sealed: "sealed-fixture", plain: null, key: "key-fixture" });
  expect(editor(draw())).toBeUndefined();
  resolve({ ok: true, ready: true, mode: "online", localRecoveryPending: true }); await settle();
  const tree = draw();
  expect(editor(tree)).toBeDefined();
  expect(copy(tree)).toContain("Previous local work is preserved and still needs recovery");
  expect(copy(tree)).not.toContain("sealed-fixture"); expect(copy(tree)).not.toContain("key-fixture");
  f.status.mockResolvedValue({ ok: true, ready: true, mode: "online", localRecoveryPending: true });
  await expect((editor(tree)!.props.beforeActivation as () => Promise<void>)()).resolves.toBeUndefined();
  expect(f.online).toHaveBeenCalledOnce();
});

it.each(["EPRIVILEGE", "EACTIVATION_REPAIR_ONLINE_BUSY", "EACTIVATION_REPAIR_ONLINE_CONFIG", "EACTIVATION_REPAIR_ONLINE_STORE"])("keeps activation closed when online continuation refuses %s", async code => {
  f.status.mockResolvedValue({ ok: false, code: "EACTIVATION_REPAIR_DATABASE_UNKNOWN" });
  f.online.mockResolvedValue({ ok: false, code, error: "private archived setup" });
  chooseRepair(); await checkRepair(); click(button(draw(), "Continue online and re-register")); await settle();
  expect(editor(draw())).toBeUndefined(); expect(copy(draw())).not.toContain("private archived setup");
});

it("does not offer online replacement for known pending work or unreadable previous identity", async () => {
  f.status.mockResolvedValue({ ok: false, code: "EACTIVATION_REPAIR_PENDING" });
  chooseRepair(); await checkRepair();
  expect(button(draw(), "Continue online and re-register")).toBeUndefined();
  expect(f.evidence).not.toHaveBeenCalled(); expect(f.online).not.toHaveBeenCalled();
});

it("requires explicit online continuation before a later replacement can open its activation form",async()=>{
  f.status.mockResolvedValue({ok:false,code:"EACTIVATION_REPAIR_ONLINE_TARGET"});
  f.online.mockResolvedValue({ok:true,ready:true,mode:"online",localRecoveryPending:true});
  chooseRepair();await checkRepair();
  expect(editor(draw())).toBeUndefined();
  click(button(draw(),"Continue online and re-register"));await settle();
  expect(editor(draw())).toBeDefined();expect(f.online).toHaveBeenCalledOnce();
});

it("does not start online recovery when retained evidence cannot be captured", async () => {
  f.status.mockResolvedValue({ ok: false, code: "EACTIVATION_REPAIR_DATABASE_UNKNOWN" });
  f.evidence.mockImplementationOnce(() => { throw new Error("private retained key"); });
  chooseRepair(); await checkRepair(); click(button(draw(), "Continue online and re-register")); await settle();
  expect(f.online).not.toHaveBeenCalled(); expect(editor(draw())).toBeUndefined();
  expect(copy(draw())).not.toContain("private retained key");
});

it.each([
  ["EACTIVATION_REPAIR_PENDING", "Previous local transactions"],
  ["EACTIVATION_REPAIR_STORE", "Windows could not read"],
  ["EACTIVATION_REPAIR_EXISTING", "available again"],
  ["EACTIVATION_REPAIR_DATABASE_UNKNOWN", "could not be verified"],
  ["EACTIVATION_REPAIR_CONTEXT", "changed during the check"],
  ["EPRIVILEGE", "authorization has expired"],
  ["EACTIVATION_REPAIR_CHECK", "could not be checked"],
])("keeps registration closed after native %s", async (code, message) => {
  f.status.mockResolvedValue({ ok: false, code, requiresLocalDatabase: true, error: "private diagnostic" });
  chooseRepair(); await checkRepair();
  const blocked = draw();
  expect(copy(blocked)).toContain(message); expect(copy(blocked)).not.toContain("private diagnostic");
  expect(editor(blocked)).toBeUndefined(); expect(button(blocked, "Connect saved local database")).toBeUndefined();
});

it("rechecks authorization before every claim and returns to repair if the native session expired", async () => {
  f.status.mockResolvedValueOnce({ ok: true, ready: true }).mockResolvedValueOnce({ ok: false, code: "EPRIVILEGE" });
  chooseRepair(); await checkRepair();
  const form = editor(draw())!;
  await expect((form.props.beforeActivation as () => Promise<void>)()).rejects.toThrow("authorization has expired");
  expect(editor(draw())).toBeUndefined(); expect(copy(draw())).toContain("authorization has expired");
});

it("keeps the same activation component mounted when verified persistence refreshes the profile", async () => {
  f.status.mockResolvedValue({ ok: true, ready: true });
  chooseRepair(); await checkRepair();
  const form = editor(draw())!;
  (form.props.onActivationStarted as () => void)();
  Object.assign(f.profile, { registrationReady: true, registrationCode: null, config: { tokenId: "new-terminal", deviceName: "Till", locationId: "A", locationName: "A" } });
  const continued = editor(draw());
  expect(continued).toBeDefined(); expect(continued?.type).toBe(form.type);
});

it.each([null, "EACTIVATION_STORE", "EREGISTRATION_UNKNOWN"])("does not offer replacement for unknown/unreadable registration %s", code => {
  f.profile.registrationCode = code;
  const tree = draw();
  expect(button(tree, "Repair or re-register terminal")).toBeUndefined(); expect(editor(tree)).toBeUndefined();
});

it("removes the prepared editor when connection recovery becomes unreadable", async () => {
  f.status.mockResolvedValue({ ok: true, ready: true });
  chooseRepair(); await checkRepair(); expect(editor(draw())).toBeDefined();
  f.profile.connectionReady = false;
  expect(editor(draw())).toBeUndefined(); expect(button(draw(), "Repair or re-register terminal")).toBeUndefined();
});

it("keeps transport exceptions private and registration closed", async () => {
  f.status.mockRejectedValue(new Error("private bridge details"));
  chooseRepair(); await checkRepair();
  expect(editor(draw())).toBeUndefined(); expect(copy(draw())).not.toContain("private bridge details");
  expect(copy(draw())).toContain("previous local setup could not be checked");
});

it.each(["connection", "registration", "unmount"])("ignores a late successful check after %s context changes", async changed => {
  let resolve!: (value: unknown) => void;
  f.status.mockReturnValue(new Promise(next => { resolve = next; }));
  chooseRepair(); click(button(draw(), "Check before re-registering"));
  if (changed === "connection") f.profile.connectionReady = false;
  if (changed === "registration") f.profile.registrationCode = "EACTIVATION_STORE";
  if (changed === "unmount") f.cleanups.forEach(cleanup => cleanup()); else draw();
  resolve({ ok: true, ready: true }); await settle();
  expect(editor(draw())).toBeUndefined();
});
