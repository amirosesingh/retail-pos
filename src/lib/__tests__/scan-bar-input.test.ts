import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ effects: [] as Array<() => (() => void) | void> }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useEffect: (effect: () => (() => void) | void) => mocks.effects.push(effect),
}));
vi.mock("@/platforms/mobile/camera", () => ({ isNativeApp: () => false, scanOnceNative: vi.fn() }));
import { ScanBar } from "@/platforms/web/components/pos/ScanBar";

afterEach(() => { mocks.effects.length = 0; vi.unstubAllGlobals(); });

it.each([false, true])("hardware scanner respects disabled=%s", disabled => {
  let handler: ((event: unknown) => void) | undefined;
  const remove = vi.fn();
  vi.stubGlobal("window", { addEventListener: (_: string, listener: typeof handler) => { handler = listener; }, removeEventListener: remove });
  vi.stubGlobal("document", { querySelector: () => null });
  const onScan = vi.fn();
  renderToStaticMarkup(createElement(ScanBar, { onScan, disabled }));
  const cleanups = mocks.effects.map(effect => effect());
  for (const key of ["1", "2", "3", "Enter"]) handler?.({ key, target: null, preventDefault: vi.fn() });
  if (disabled) { expect(handler).toBeUndefined(); expect(onScan).not.toHaveBeenCalled(); }
  else { expect(onScan).toHaveBeenCalledExactlyOnceWith("123"); }
  cleanups.forEach(cleanup => cleanup?.());
  if (!disabled) expect(remove).toHaveBeenCalledOnce();
});
