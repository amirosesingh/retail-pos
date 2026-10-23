import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NativeUpdateOrb } from "@/components/ui/native-update-orb";

describe("native update action", () => {
  it("exposes measured progress while a download continues", () => {
    const html = renderToStaticMarkup(h(NativeUpdateOrb, {
      label: "Beta update 1.4.77-beta.1", detail: "Downloading 37%", progress: 37,
      busy: true, onClick: () => {},
    }));
    expect(html).toContain("Downloading 37%");
    expect(html).toContain("37%");
    expect(html).toContain(' disabled=""');
  });

  it("keeps the same action available once the download is ready", () => {
    const html = renderToStaticMarkup(h(NativeUpdateOrb, {
      label: "Update 1.4.77-beta.1", detail: "Downloaded. Tap to install.", onClick: () => {},
    }));
    expect(html).toContain("Downloaded. Tap to install.");
    expect(html).not.toContain(' disabled=""');
  });
});
