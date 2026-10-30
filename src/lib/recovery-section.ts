export type RecoverySection = "activation" | "connection";

/** Only presentation hints; a section never unlocks recovery authorization. */
export function recoverySearch(search: Record<string, unknown>): { section?: RecoverySection } {
  return search.section === "activation" || search.section === "connection" ? { section: search.section } : {};
}
