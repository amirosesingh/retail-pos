import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: () => [false, vi.fn()] };
});
vi.mock("@/lib/app-updates", () => ({ APP_VERSION: "1.0.0" }));

import { MinimalUpdatePanel, UpdateConfirmation } from "@/platforms/web/components/pos/MinimalUpdatePanel";

type Element = ReactElement<Record<string, unknown>>;
function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<Record<string, unknown>>(node) ? text(node.props.children) : "";
}
function action(node: unknown, label: string): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = action(child, label);
      if (found) return found;
    }
  }
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (typeof node.props.onClick === "function" && text(node.props.children).trim() === label) return node;
  return action(node.props.children, label);
}

const download = vi.fn();
const install = vi.fn();
const downloadAndInstall = vi.fn();
function updates(status = "available") {
  return {
    state: { status, available: "1.0.1", version: "1.0.0", percent: 0, error: null },
    installing: false, installError: null, supported: true, manifestChecking: false, releaseNotes: null,
    check: vi.fn(), download, install, downloadAndInstall,
  } as unknown as Parameters<typeof MinimalUpdatePanel>[0]["updates"];
}
beforeEach(() => vi.clearAllMocks());

describe("Windows update download and restart actions", () => {
  it("downloads from Settings without preparing installation or synchronization", () => {
    const tree = MinimalUpdatePanel({ updates: updates() });
    const button = action(tree, "Download update")!;
    expect(button.props.disabled).toBe(false);
    (button.props.onClick as () => void)();
    expect(download).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
    expect(downloadAndInstall).not.toHaveBeenCalled();
  });

  it("keeps the header confirmation download separate from restart", () => {
    const tree = UpdateConfirmation({ updates: updates(), open: true, onOpenChange: vi.fn() });
    const button = action(tree, "Download update")!;
    (button.props.onClick as () => void)();
    expect(download).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
    expect(downloadAndInstall).not.toHaveBeenCalled();
  });

  it("installs only after an explicit action on a fully downloaded update", () => {
    const tree = UpdateConfirmation({ updates: updates("ready"), open: true, onOpenChange: vi.fn() });
    const button = action(tree, "Restart and install")!;
    (button.props.onClick as () => void)();
    expect(install).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(text(tree)).toContain("Saved records waiting to upload will resume syncing");
  });

  it("disables the action while the package is downloading", () => {
    const tree = MinimalUpdatePanel({ updates: updates("downloading") });
    expect(action(tree, "Downloading…")?.props.disabled).toBe(true);
    const confirmation = UpdateConfirmation({ updates: updates("downloading"), open: true, onOpenChange: vi.fn() });
    expect(action(confirmation, "Downloading…")?.props.disabled).toBe(true);
  });
});
