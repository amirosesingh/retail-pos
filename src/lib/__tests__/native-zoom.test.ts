import { describe, expect, it, vi } from "vitest";
import { installNativeZoomLock } from "../native-zoom";

describe("native zoom lock", () => {
  it("fits Android within reported system bars instead of covering navigation controls", () => {
    const viewport = { getAttribute: () => "old", setAttribute: vi.fn() };
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    installNativeZoomLock(target as unknown as Window, { querySelector: () => viewport } as unknown as Document, "contain")();
    expect(viewport.setAttribute.mock.calls[0][1]).toContain("viewport-fit=contain");
    expect(viewport.setAttribute).toHaveBeenLastCalledWith("content", "old");
  });
  it("blocks pinch and zoom shortcuts while preserving scrolling, typing and saved display scaling", () => {
    const listeners = new Map<string, (event: never) => void>();
    const target = {
      addEventListener: (name: string, listener: (event: never) => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    const viewport = { getAttribute: () => "original", setAttribute: vi.fn() };
    const stop = installNativeZoomLock(target as unknown as Window, { querySelector: () => viewport } as unknown as Document);
    const fire = (name: string, data: object) => {
      const preventDefault = vi.fn();
      listeners.get(name)!({ ...data, preventDefault } as never);
      return preventDefault;
    };
    expect(fire("touchmove", { touches: [1, 2] })).toHaveBeenCalledOnce();
    expect(fire("touchmove", { touches: [1] })).not.toHaveBeenCalled();
    expect(fire("wheel", { ctrlKey: true })).toHaveBeenCalledOnce();
    expect(fire("wheel", { ctrlKey: false })).not.toHaveBeenCalled();
    expect(fire("keydown", { ctrlKey: true, key: "+" })).toHaveBeenCalledOnce();
    expect(fire("keydown", { ctrlKey: true, key: "c" })).not.toHaveBeenCalled();
    expect(fire("keydown", { ctrlKey: false, key: "+" })).not.toHaveBeenCalled();
    stop();
    expect(listeners.size).toBe(0);
    expect(viewport.setAttribute).toHaveBeenLastCalledWith("content", "original");
  });
});
