import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { REGISTER_ACTIONS } from "@/lib/register-actions";
import { sanitiseLayout } from "@/lib/register-layout";
import { writeLocal } from "@/lib/layout-store";
import {
  draggedCanvasPosition,
  paletteDropCell,
  palettePreviewOffset,
} from "@/lib/canvas-coordinates";

describe("register canvas pointer alignment", () => {
  const rect = { left: 100, top: 50, width: 960, height: 540 };

  it("keeps the grabbed point under the mouse on both axes", () => {
    expect(draggedCanvasPosition(500, 300, 40, 20, rect, 1920, 1080)).toEqual({
      left: 720,
      top: 460,
    });
  });

  it("centres a palette item on the exact drop cell", () => {
    expect(
      paletteDropCell({
        clientX: 420,
        clientY: 145,
        rect,
        logicalWidth: 1920,
        logicalHeight: 1080,
        cols: 24,
        rowHeight: 20,
        itemW: 4,
        itemH: 3,
      }),
    ).toEqual({ x: 6, y: 8 });
  });

  it("corrects the scaled palette preview centre", () => {
    expect(palettePreviewOffset(rect, 1920, 1080, 320, 60)).toEqual({ x: 80, y: 15 });
  });
});

describe("register canvas persistence", () => {
  it("keeps layout switching separate from deleting the saved canvas", () => {
    const workspace = readFileSync(
      resolve(process.cwd(), "src/platforms/web/components/pos/layout/RegisterWorkspace.tsx"),
      "utf8",
    );
    expect(workspace).toContain('onModeChange?.("standard")');
    expect(workspace).toContain('effectiveMode === "canvas" && !!layout.saved');
    expect(workspace).toContain("Delete custom layout");
  });

  it("clamps malformed saved geometry to the canvas", () => {
    const layout = sanitiseLayout({
      canvas: { cols: 12, rowHeight: 20, baseWidth: 1280, aspect: "16:9" },
      items: [
        { i: "cartLines", x: -8, y: -4, w: 99, h: -2 },
        { i: "actCharge", x: 99, y: 3, w: 8, h: 3 },
      ],
    });

    expect(layout?.items).toEqual([
      expect.objectContaining({ i: "cartLines", x: 0, y: 0, w: 12, h: 4 }),
      expect.objectContaining({ i: "actCharge", x: 4, y: 3, w: 8, h: 3 }),
    ]);
  });

  it("drops unknown nodes and dangling group references", () => {
    const layout = sanitiseLayout({
      canvas: { cols: 24 },
      items: [
        { i: "actCharge", x: 0, y: 0, w: 8, h: 3, parent: "group:missing" },
        { i: "not-a-real-module", x: 0, y: 4, w: 4, h: 3 },
      ],
    });

    expect(layout?.items).toHaveLength(1);
    expect(layout?.items[0]).toEqual(expect.objectContaining({ i: "actCharge" }));
    expect(layout?.items[0]?.parent).toBeUndefined();
  });

  it("reports blocked browser storage instead of claiming the layout saved", () => {
    const setItem = vi.fn(() => {
      throw new Error("storage blocked");
    });
    vi.stubGlobal("window", {
      localStorage: { setItem, removeItem: vi.fn(), getItem: vi.fn() },
    });

    expect(writeLocal("layout", "{}")).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("register canvas actions", () => {
  it("implements every action that cannot navigate to a page", () => {
    const register = readFileSync(resolve(process.cwd(), "src/routes/index.tsx"), "utf8");
    for (const action of REGISTER_ACTIONS.filter((entry) => !entry.to)) {
      expect(register, `${action.id} has no register handler`).toContain(`"${action.id}"`);
    }
  });

  it("clears a palette drag even when it ends outside the canvas", () => {
    const palette = readFileSync(
      resolve(process.cwd(), "src/platforms/web/components/pos/layout/FeaturePalette.tsx"),
      "utf8",
    );
    expect(palette).toContain("onDragEnd={onDragEnd}");
  });
});
