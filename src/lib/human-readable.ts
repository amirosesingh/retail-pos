type NamedRecord = { id: string; name: string };
type ReferencedSale = { id: string; receiptNo: string };

export type FriendlyReferences = {
  stores?: NamedRecord[];
  products?: NamedRecord[];
  members?: NamedRecord[];
  sales?: ReferencedSale[];
};

/** Resolve a branch identifier without ever exposing an internal UUID to users. */
export function branchDisplayName(
  stores: readonly NamedRecord[],
  id: string | null | undefined,
  fallback = "Unknown branch",
): string {
  if (!id) return fallback;
  const branch = stores.find((row) => row.id === id);
  return branch?.name?.trim() || fallback;
}

/** Replace identifiers already known to the client with the names users recognise. */
export function humanizeText(value: string, refs: FriendlyReferences): string {
  return createTextHumanizer(refs)(value);
}

/** Build the catalogue lookup once for a feed, rather than once per rendered line. */
export function createTextHumanizer(refs: FriendlyReferences): (value: string) => string {
  const replacements = [
    ...(refs.stores ?? []).map((row) => [row.id, row.name] as const),
    ...(refs.products ?? []).map((row) => [row.id, row.name] as const),
    ...(refs.members ?? []).map((row) => [row.id, row.name] as const),
    ...(refs.sales ?? []).map((row) => [row.id, row.receiptNo] as const),
  ]
    .filter(([id, name]) => id && name && id !== name)
    .sort((a, b) => b[0].length - a[0].length);
  const cache = new Map<string, string>();
  return value => {
    const cached = cache.get(value);
    if (cached !== undefined) return cached;
    let result = value;
    for (const [id, name] of replacements)
      if (result.includes(id)) result = result.split(id).join(name);
    if (cache.size >= 512) cache.clear();
    cache.set(value, result);
    return result;
  };
}

export function friendlyReference(id: string | null | undefined, refs: FriendlyReferences): string {
  if (!id) return "—";
  return (
    refs.stores?.find((row) => row.id === id)?.name ??
    refs.products?.find((row) => row.id === id)?.name ??
    refs.members?.find((row) => row.id === id)?.name ??
    refs.sales?.find((row) => row.id === id)?.receiptNo ??
    "Related record"
  );
}
