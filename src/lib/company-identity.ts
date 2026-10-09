/** Company identity is shared by every branch; receipt layout remains local. */
export const COMPANY_IDENTITY_FIELDS = [
  "companyName", "logo", "taxNumber", "regNumber", "phone", "website", "headerText", "footerText",
] as const;

export function isCompanyIdentityPath(path: string): boolean {
  return COMPANY_IDENTITY_FIELDS.some(field => path === `receipt.${field}`);
}

export function withoutCompanyIdentity(patch: Record<string, unknown> | undefined) {
  const receipt = patch?.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return patch;
  const cleaned = { ...receipt } as Record<string, unknown>;
  for (const field of COMPANY_IDENTITY_FIELDS) delete cleaned[field];
  return { ...patch, receipt: cleaned };
}
