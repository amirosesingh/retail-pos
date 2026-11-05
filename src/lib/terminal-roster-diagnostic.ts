type DiagnosticInput = {
  backendUrl: unknown;
  outgoingProof: unknown;
  nativeResult: unknown;
  status?: unknown;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
const present = (value: unknown): string => typeof value === "string" ? value.trim() : "";

/** Development diagnostics contain presence/comparison results, never credentials. */
export function terminalRosterDiagnostic(input: DiagnosticInput): {
  backendOrigin: string;
  tokenPresent: boolean;
  proofPresent: boolean;
  nativeReadable: boolean;
  nativeRegistered: boolean;
  nativeProofPresent: boolean;
  sameToken: boolean;
  sameProof: boolean;
  status?: number;
} {
  let backendOrigin = "";
  if (typeof input.backendUrl === "string") {
    try {
      const origin = new URL(input.backendUrl).origin;
      if (origin !== "null") backendOrigin = origin;
    } catch { /* A malformed address must not enter the diagnostic output. */ }
  }
  const outgoing = record(input.outgoingProof);
  const native = record(input.nativeResult);
  const nativeReadable = native?.ok === true;
  const config = nativeReadable ? record(native?.config) : null;
  const token = present(outgoing?.terminalToken);
  const proof = present(outgoing?.deviceBindingProof);
  const nativeToken = present(config?.tokenId);
  const nativeProof = present(config?.deviceBindingProof);
  return {
    backendOrigin,
    tokenPresent: Boolean(token),
    proofPresent: Boolean(proof),
    nativeReadable,
    nativeRegistered: Boolean(nativeToken),
    nativeProofPresent: Boolean(nativeProof),
    sameToken: Boolean(token && nativeToken && token === nativeToken),
    sameProof: /^[a-f0-9]{64}$/i.test(proof) && /^[a-f0-9]{64}$/i.test(nativeProof) && proof.toLowerCase() === nativeProof.toLowerCase(),
    ...(typeof input.status === "number" && Number.isFinite(input.status) ? { status: input.status } : {}),
  };
}
