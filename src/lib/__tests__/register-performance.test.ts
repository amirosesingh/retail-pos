import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("cashier register performance boundaries", () => {
  it("uses layout zoom instead of one permanent full-register transform layer", () => {
    const canvas = read("src/platforms/web/components/pos/ZoomCanvas.tsx");
    expect(canvas).toContain("zoom: scale");
    expect(canvas).not.toContain('transform: `scale(${scale})`');
    expect(canvas).not.toContain('willChange: "transform"');
  });

  it("does not poll every transfer and rerender unchanged POS state each minute", () => {
    const store = read("src/lib/pos-store.tsx");
    const transferRefresh = store.slice(
      store.indexOf("// Transfers are not part of the register's small startup snapshot."),
      store.indexOf("// Overrides follow the cluster, branch and selected terminal in context."),
    );
    expect(transferRefresh).toContain("hasSameValue(current.transfers, transfers)");
    expect(transferRefresh).not.toContain("setInterval");
    expect(store).toContain("hasSameValue(current, next) ? current : next");
    expect(store).toContain("hasSameValue(current.settings, next)");
  });

  it("pauses header and browser sync polling while the app is backgrounded", () => {
    const clock = read("src/platforms/web/components/pos/LiveClock.tsx");
    const activity = read("src/platforms/web/components/pos/ActivityBell.tsx");
    const status = read("src/platforms/web/components/pos/StatusCluster.tsx");
    const errors = read("src/platforms/web/components/pos/ErrorNotifier.tsx");
    const sync = read("src/lib/sync-engine.ts");

    for (const source of [clock, activity, status, errors, sync]) {
      expect(source).toContain("document.visibilityState");
      expect(source).toContain('document.addEventListener("visibilitychange"');
      expect(source).toContain('document.removeEventListener("visibilitychange"');
    }
    expect(sync).toContain('void runExclusive("background")');
    expect(sync).toContain("handleVisibilityChange");
    expect(sync).toContain("wake()");
  });
});
