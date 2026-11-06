import { Children, Fragment, cloneElement, isValidElement, type ReactNode } from "react";

/** Presentation only: never infer numeric meaning from a formatted label. */
export function hasSummaryMetric(value: number, moneyValue = false): boolean {
  return Number.isFinite(value) && (moneyValue ? Math.abs(value) >= 0.005 : value !== 0);
}

/** Filter before creating rail items, so zero metrics leave no empty slide. */
export function visibleMetricCards(children: ReactNode, ancestry = ""): ReactNode[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; metricValue?: number; moneyValue?: boolean }>(child)) return [];
    const key = `${ancestry}/${child.key}`;
    if (child.type === Fragment) return visibleMetricCards(child.props.children, key);
    return child.props.metricValue !== undefined && !hasSummaryMetric(child.props.metricValue, child.props.moneyValue) ? [] : [cloneElement(child, { key })];
  });
}
