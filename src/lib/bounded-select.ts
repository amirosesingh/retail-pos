export type SelectOption = { value: string; label: string };
/** Stop after the visible window; searching still reaches every catalogue entry. */
export function boundedSelectOptions(options: SelectOption[], query: string, limit = 100) {
  const term = query.trim().toLowerCase();
  const items: SelectOption[] = [];
  for (const option of options) {
    if (term && !`${option.label} ${option.value}`.toLowerCase().includes(term)) continue;
    if (items.length === limit) return { items, hasMore: true };
    items.push(option);
  }
  return { items, hasMore: false };
}
