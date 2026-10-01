import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("boolean switch consistency", () => {
  it("uses the shared shadcn switch track and thumb dimensions", () => {
    const component = readFileSync("src/components/ui/switch.tsx", "utf8");
    const styles = readFileSync("src/styles.css", "utf8");
    expect(component).toContain('data-slot="switch"');
    expect(component).toContain('data-slot="switch-thumb"');
    expect(component).toContain("h-6 w-11");
    expect(component).toContain("size-5");
    expect(styles).toContain('.pos-scaled button[data-slot="switch"]');
  });

  it("does not implement boolean controls with native checkbox inputs", () => {
    let matches = "";
    try {
      matches = execFileSync("rg", ["-n", 'type=\\"checkbox\\"', "src", "-g", "*.tsx"], {
        encoding: "utf8",
      }).trim();
    } catch (error) {
      if ((error as { status?: number }).status !== 1) throw error;
    }
    expect(matches).toBe("");
  });
});
