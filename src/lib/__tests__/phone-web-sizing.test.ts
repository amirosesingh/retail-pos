import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeUiTextSize } from "../use-ui-scale";

describe("phone website sizing", () => {
  it("uses compact text on phone Web without changing desktop or native defaults", () => {
    for (const width of [320, 360, 390, 430, 767])
      expect(computeUiTextSize(width, 1)).toBe(14);
    for (const width of [768, 1024, 1440])
      expect(computeUiTextSize(width, 1)).toBe(16);
    expect(computeUiTextSize(390, 1, true)).toBe(16);
  });
  it("sizes Capacitor phones compactly while retaining desktop terminal sizing", () => {
    expect(computeUiTextSize(390, 1, true, true)).toBe(14);
    expect(computeUiTextSize(390, 1.5, true, true)).toBe(21);
    expect(computeUiTextSize(800, 1, true, true)).toBe(16);
    expect(computeUiTextSize(390, 1, true, false)).toBe(16);
  });
  it("retains the saved text-size multiplier on every platform", () => {
    expect(computeUiTextSize(390, 1.5)).toBe(21);
    expect(computeUiTextSize(1440, 1.5)).toBe(24);
    expect(computeUiTextSize(390, 1.5, true)).toBe(24);
  });
  it("keeps register zoom controlled by Settings rather than gesture writes", () => {
    const canvas = readFileSync("src/platforms/web/components/pos/ZoomCanvas.tsx", "utf8");
    expect(canvas).toContain("useUiScalePrefs()");
    expect(canvas).not.toContain("setUiScalePrefs");
    expect(canvas).not.toContain('addEventListener("wheel"');
  });
});
