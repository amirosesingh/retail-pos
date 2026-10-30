import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ login: vi.fn(), states: [] as unknown[] }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: () => undefined,
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, (next: unknown) => h.states.push(next)],
}));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({ login: h.login }) }));
vi.mock("@/lib/branding", () => ({ useBranding: () => ({ company: "Test company" }) }));
vi.mock("@/platform-config/approval-token", () => ({ ApprovalTokenButton: () => null }));
vi.mock("@/platform-config/platform", () => ({ isNative: () => false, isTerminalApp: () => false }));
vi.mock("@/platform-config/password-manager", () => ({ hasNativePasswordManager: false }));
vi.mock("@/platforms/web/components/auth/CashierPinLogin", () => ({ CashierPinLogin: () => null }));
import { TerminalLogin } from "@/platforms/web/components/pos/TerminalLogin";

function form(node: unknown): ReactElement<{ onSubmit: (event: unknown) => Promise<void> }> | undefined {
  if (!node || typeof node !== "object") return;
  const element = node as ReactElement<{ children?: unknown; onSubmit: (event: unknown) => Promise<void> }>;
  if (element.type === "form") return element;
  for (const child of [element.props?.children].flat()) {
    const found = form(child);
    if (found) return found;
  }
}
const event = { preventDefault: vi.fn(), currentTarget: {} };
afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks(); h.states.length = 0;
  vi.stubGlobal("FormData", class {
    get(key: string) { return key === "username" ? "administrator@example.test" : "test-only-password"; }
  });
});

it("releases the password login panel after a rejected provider call", async () => {
  h.login.mockRejectedValueOnce(Object.assign(new Error("context deadline exceeded"), { status: 504 }));
  const panel = form(TerminalLogin())!;
  await expect(panel.props.onSubmit(event)).resolves.toBeUndefined();
  expect(h.states).toContain("cloud-unreachable");
  expect(h.states.at(-1)).toBe(false);
  expect(h.login).toHaveBeenCalledOnce();
});

it("submits only one password request during a slow response and allows retry after failure", async () => {
  let finish!: (value: unknown) => void;
  h.login.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const panel = form(TerminalLogin())!;
  const first = panel.props.onSubmit(event);
  await panel.props.onSubmit(event);
  expect(h.login).toHaveBeenCalledOnce();
  finish({ ok: false, code: "cloud-unreachable", error: "Service unavailable" });
  await first;
  expect(h.states.at(-1)).toBe(false);
  h.login.mockResolvedValueOnce({ ok: true });
  await panel.props.onSubmit(event);
  expect(h.login).toHaveBeenCalledTimes(2);
  expect(h.states.at(-1)).toBe(false);
});
