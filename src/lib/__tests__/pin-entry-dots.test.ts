import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PinEntryDots } from "@/components/ui/pin-entry-dots";

it("starts at six dots and grows with a longer PIN without shrinking or exposing digits", () => {
  for (const length of [0, 4, 6, 7, 10, 12]) {
    const html = renderToStaticMarkup(createElement(PinEntryDots, { length }));
    expect(html.match(/<span /g)).toHaveLength(Math.max(6, length));
    expect(html.match(/bg-primary/g) ?? []).toHaveLength(length);
    expect(html).toContain("shrink-0");
    expect(html).toContain("flex-wrap");
  }
});
