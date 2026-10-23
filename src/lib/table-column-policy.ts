/** UI column choices. Sensitive fields still require their existing server permission checks. */
import { TABLE_CATALOG } from "./table-catalog";

export const tableColumnKey = (tableId: string, column: number) => `table:${tableId}:${column}`;

/** Keep saved column choices tied to the catalog when permission-gated columns are absent. */
export function catalogColumnPositions(tableId: string, labels: readonly string[]): number[] {
  const catalog = TABLE_CATALOG.find(row => row.id === tableId)?.columns;
  if (!catalog) return labels.map((_, index) => index);
  let previous = -1;
  return labels.map((label, visibleIndex) => {
    const actual = label.trim().toLowerCase();
    if (!actual && visibleIndex === 0 && /^column 1$/i.test(catalog[0] ?? "")) {
      previous = 0;
      return 0;
    }
    const position = catalog.findIndex((candidate, index) => index > previous && (
      candidate.trim().toLowerCase() === actual ||
      (candidate.trim().length > 2 && actual.startsWith(candidate.trim().toLowerCase()))
    ));
    if (position < 0) return catalog.length + visibleIndex;
    previous = position;
    return position;
  });
}

export function tableColumnHidden(
  rules: Record<string, string[]>, tableId: string, column: number,
  role: string | null, userId: string | null,
): boolean {
  const scopes = rules[tableColumnKey(tableId, column)] ?? [];
  return scopes.includes("all") || (!!role && scopes.includes(`role:${role}`)) ||
    (!!userId && scopes.includes(`user:${userId}`));
}

export function withTableColumnRule(
  rules: Record<string, string[]>, tableId: string, column: number,
  scope: string, hide: boolean,
): Record<string, string[]> {
  const key = tableColumnKey(tableId, column);
  const next = new Set(rules[key] ?? []);
  if (hide) next.add(scope);
  else next.delete(scope);
  const result = { ...rules };
  if (next.size) result[key] = [...next];
  else delete result[key];
  return result;
}
