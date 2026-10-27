import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { deviceProofHash } from "@/core/activation/device-proof";

/** Present the existing claimed registration when establishing native authority.
 * Browser management has no registration, and replica secrets never travel here.
 */
export async function readNativeTerminalProof(): Promise<{
  terminalToken?: string;
  deviceBindingProof?: string;
}> {
  const registration = readTerminalConfig();
  if (!registration?.tokenId) return {};
  const saved = registration.deviceBindingProof;
  const proof = typeof saved === "string" && /^[a-f0-9]{64}$/i.test(saved)
    ? saved.toLowerCase()
    : await deviceProofHash();
  return {
    terminalToken: registration.tokenId,
    ...(proof ? { deviceBindingProof: proof } : {}),
  };
}
