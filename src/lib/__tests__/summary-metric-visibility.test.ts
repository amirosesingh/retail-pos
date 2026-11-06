import { createElement as h, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { hasSummaryMetric, visibleMetricCards } from "../summary-metric-visibility";
import { AnimatedMetric } from "@/platforms/web/components/pos/AnimatedMetric";

vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({ ready: true, user: null }) }));
vi.mock("@/lib/pos-store", () => ({ usePosOptional: () => null }));

describe("confirmed summary presentation", () => {
  it("uses raw numeric meaning, preserving meaningful negatives and fractional stock", () => {
    for (const value of [1, -1, 0.001, -0.001]) expect(hasSummaryMetric(value)).toBe(true);
    for (const value of [0, -0, NaN, Infinity, -Infinity]) expect(hasSummaryMetric(value)).toBe(false);
    for (const value of [0.005, -0.005, 12.345]) expect(hasSummaryMetric(value, true)).toBe(true);
    for (const value of [0.004, -0.004, 0, NaN]) expect(hasSummaryMetric(value, true)).toBe(false);
  });
  it("filters fragments before rail slides exist, without parsing currency labels", () => {
    const Card = (_props: { metricValue?: number; moneyValue?: boolean; label?: string }) => null;
    const result = visibleMetricCards(h(Fragment, null,
      h(Card, { key: "zero", metricValue: 0, label: "Zero" }),
      h(Fragment, null, h(Card, { key: "negative", metricValue: -3 }),
        h(Card, { key: "small", metricValue: 0.001, moneyValue: true })),
      h(Card, { key: "informative", label: "Restricted" }), false));
    expect(result).toHaveLength(2);
    expect(result.map(node => (node as { props: { metricValue?: number } }).props.metricValue)).toEqual([-3, undefined]);
  });
  it("keeps fragment ancestry keys unique and stable as optional cards appear", () => {
    const Card = (_props: {metricValue?:number}) => null;
    const tree = (show:boolean) => [h(Card, {metricValue:1}), h(Fragment, null, show && h(Card, {metricValue:2}), show && h(Card, {metricValue:3})), h(Card, {metricValue:4})];
    const shown=visibleMetricCards(tree(true)), hidden=visibleMetricCards(tree(false));
    const keys=(nodes:unknown[])=>nodes.map(node=>(node as {key:string}).key);
    expect(new Set(keys(shown)).size).toBe(4);
    expect(keys(hidden)).toEqual([keys(shown)[0],keys(shown)[3]]);
  });
  it("shows confirmed quantities and formatted amounts immediately on first render", () => {
    expect(renderToStaticMarkup(h(AnimatedMetric, { value: 1535 }))).toContain(">1,535</span>");
    expect(renderToStaticMarkup(h(AnimatedMetric, { value: -2186.125, format: n => `B$${n.toFixed(3)}` }))).toContain(">B$-2186.125</span>");
  });
});
