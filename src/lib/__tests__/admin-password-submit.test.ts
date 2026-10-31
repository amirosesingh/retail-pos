import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useEffect: () => undefined,
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [typeof value === "function" ? value() : value, vi.fn()],
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({ login: h.login }) }));
vi.mock("@/lib/branding", () => ({ useBranding: () => ({ company: "Test company" }) }));
vi.mock("@/platform-config/approval-token", () => ({ ApprovalTokenButton: () => null }));
vi.mock("@/platform-config/platform", () => ({ isNative: () => false, isTerminalApp: () => false }));
vi.mock("@/platform-config/password-manager", () => ({ hasNativePasswordManager: false }));
vi.mock("@/platforms/web/components/auth/CashierPinLogin", () => ({ CashierPinLogin: () => null }));
import { TerminalLogin } from "@/platforms/web/components/pos/TerminalLogin";
import { createLoginView } from "../login-view";

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
  vi.clearAllMocks();
  vi.stubGlobal("FormData", class {
    get(key: string) { return key === "username" ? "administrator@example.test" : "test-only-password"; }
  });
});

it("releases the password login panel after a rejected provider call", async () => {
  h.login.mockRejectedValueOnce(Object.assign(new Error("context deadline exceeded"), { status: 504 }));
  const view = createLoginView();
  const panel = form(TerminalLogin({ view }))!;
  await expect(panel.props.onSubmit(event)).resolves.toBeUndefined();
  expect(view.getSnapshot()).toMatchObject({ failure: "cloud-unreachable", busy: false });
  expect(h.login).toHaveBeenCalledOnce();
});

it("submits only one password request during a slow response and allows retry after failure", async () => {
  let finish!: (value: unknown) => void;
  h.login.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = createLoginView();
  const panel = form(TerminalLogin({ view }))!;
  const first = panel.props.onSubmit(event);
  await panel.props.onSubmit(event);
  expect(h.login).toHaveBeenCalledOnce();
  finish({ ok: false, code: "cloud-unreachable", error: "Service unavailable" });
  await first;
  expect(view.getSnapshot().busy).toBe(false);
  h.login.mockResolvedValueOnce({ ok: true });
  await panel.props.onSubmit(event);
  expect(h.login).toHaveBeenCalledTimes(2);
  expect(view.getSnapshot().busy).toBe(false);
});
