import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
    expect(component).toContain("data-[state=checked]:translate-x-full");
    expect(styles).toContain(':not([role="switch"])');
    expect(styles).not.toContain('.pos-scaled button[data-slot="switch"]');
    expect(component).toContain('shrink-0 p-0');
    expect(styles).toContain('button[data-slot="switch"]::before');
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



describe("toggle semantics after sizing fixes", () => {
  it("preserves checked/disabled switch state and label association", () => {
    const html = renderToStaticMarkup(h(Switch, { checked: true, disabled: true, "aria-label": "Branch visibility", id: "branch-setting" }));
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-label="Branch visibility"');
    expect(html).toContain('id="branch-setting"');
  });
  it("marks both pressed buttons and group items for consistent sizing", () => {
    expect(renderToStaticMarkup(h(Toggle, { pressed: true }, "Filter"))).toContain('aria-pressed="true"');
    const html = renderToStaticMarkup(h(ToggleGroup, { type: "single", value: "table" }, h(ToggleGroupItem, { value: "table" }, "Table"), h(ToggleGroupItem, { value: "cards" }, "Cards")));
    expect(html.match(/data-slot="toggle"/g)).toHaveLength(2);
    expect(html).toContain('aria-checked="true"');
  });
});
