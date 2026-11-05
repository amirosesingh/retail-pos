/** Reserved transport metadata, never a user-mapped inventory column. */
export const IMPORT_SOURCE_ROW = "__pos_import_source_row";

export function importSourceLine(row: Record<string, unknown>, index: number): number {
  const source = row[IMPORT_SOURCE_ROW];
  return typeof source === "number" && Number.isSafeInteger(source) && source >= 2 ? source : index + 2;
}
