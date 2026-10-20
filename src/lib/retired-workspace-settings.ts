/** Ignore retired purpose preferences without dropping any other integration setting. */
export function withoutWorkspacePurpose<T extends object>(input: T): T {
  const result = { ...input };
  delete (result as Record<string, unknown>).terminalPurpose;
  delete (result as Record<string, unknown>).terminalPurposeOverride;
  return result;
}
