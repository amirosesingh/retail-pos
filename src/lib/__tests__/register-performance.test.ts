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
});
