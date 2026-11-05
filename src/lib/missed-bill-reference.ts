/** Dedicated server-issued namespace; ordinary receipt numbers are unaffected. */
export function isMissedBillReference(reference: string): boolean {
  return /^MB-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference);
}
