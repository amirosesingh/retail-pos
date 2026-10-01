import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
    const matches: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith(".tsx") && readFileSync(path, "utf8").includes('type="checkbox"'))
          matches.push(path);
      }
    };
    visit("src");
    expect(matches).toEqual([]);
  });
});
