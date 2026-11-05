const normalizeColumn = (label: string) => label.replace(/\s+/g, " ").trim();
const numericQuantity = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** Only the current branch's numeric Stock column search crosses view modes. */
export function currentBranchStockColumnQuantity(filters: Record<string, string>, branchCode: string): number | null {
  const heading = normalizeColumn(`Stock · ${branchCode}`);
  const term = Object.entries(filters).find(([label]) => normalizeColumn(label) === heading)?.[1].trim() ?? "";
  const quantity = Number(term);
  return numericQuantity.test(term) && Number.isFinite(quantity) ? quantity : null;
}

/** AND across named columns; each term searches only its own column value. */
export function inventoryColumnsMatch(values: Record<string, string>, filters: Record<string, string>, quantities: Record<string, number> = {}): boolean {
  const columns = Object.fromEntries(Object.entries(values).map(([label, value]) => [normalizeColumn(label), value]));
  const numeric = Object.fromEntries(Object.entries(quantities).map(([label, value]) => [normalizeColumn(label), value]));
  return Object.entries(filters).every(([label, query]) => {
    label = normalizeColumn(label);
    const term = query.trim();
    if (!term || !(label in columns)) return true;
    if (label in numeric && numericQuantity.test(term))
      return Number.isFinite(numeric[label]) && numeric[label] === Number(term);
    if (label.startsWith("Stock · ") && numericQuantity.test(term)) {
      const quantity = Number(columns[label].trim().split(/\s+/)[0]);
      return Number.isFinite(quantity) && quantity === Number(term);
    }
    return columns[label].toLocaleLowerCase().includes(term.toLocaleLowerCase());
  });
}
