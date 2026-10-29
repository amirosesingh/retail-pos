/** AND across named columns; each term searches only its own column value. */
export function inventoryColumnsMatch(values: Record<string, string>, filters: Record<string, string>): boolean {
  const normalize = (label: string) => label.replace(/\s+/g, " ").trim();
  const columns = Object.fromEntries(Object.entries(values).map(([label, value]) => [normalize(label), value]));
  return Object.entries(filters).every(([label, query]) => {
    label = normalize(label);
    const term = query.trim();
    if (!term || !(label in columns)) return true;
    if (label.startsWith("Stock · ") && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(term)) {
      const quantity = Number(columns[label].trim().split(/\s+/)[0]);
      return Number.isFinite(quantity) && quantity === Number(term);
    }
    return columns[label].toLocaleLowerCase().includes(term.toLocaleLowerCase());
  });
}
