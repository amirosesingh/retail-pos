import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { deviceProofHash } from "@/core/activation/device-proof";
import { terminalRuntimePlatform } from "@/core/activation/terminal-platform";
import { recordId } from "./sale-identity";

export class NativeTerminalProofError extends Error {
  constructor(readonly code: "EAUTH_UNAVAILABLE" | "EACTIVATION_BINDING", readonly status: 503 | 403) {
    super(code === "EAUTH_UNAVAILABLE"
      ? "The saved terminal registration could not be read. Retry without changing its registration."
      : "The saved terminal registration does not match this session. Review terminal setup.");
  }
}
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const refuse = (): never => { throw new NativeTerminalProofError("EACTIVATION_BINDING", 403); };
function binding(value: unknown): string {
  const config = object(value);
  const token = recordId(text(config?.tokenId));
  if (!token) return refuse();
  const branches = [config?.locationId, config?.storeId, config?.branchId].map(value => recordId(text(value))).filter(Boolean);
  if (new Set(branches).size > 1) return refuse();
  const branch = branches[0] ?? "";
  const mode = config?.deviceUse ?? (branch ? "operations" : "management");
  const platform = config?.deviceType ?? "pc";
  if ((mode !== "operations" && mode !== "management") || (mode === "operations" && !branch) || (mode === "management" && branch)) return refuse();
  // This comparison is used only by Electron's native read path. A mobile
  // registration must never supply a PC's request proof, even if ids match.
  if ((platform !== "pc" && platform !== "mobile") || platform !== "pc") return refuse();
  return JSON.stringify([token, platform, branch, mode]);
}

/** Present the existing claimed registration when establishing native authority.
 * Browser management has no registration, and replica secrets never travel here.
 */
export async function readNativeTerminalProof(): Promise<{
  terminalToken?: string;
  deviceBindingProof?: string;
}> {
  const registration = readTerminalConfig();
  if (!registration?.tokenId) return {};
  let saved = registration.deviceBindingProof;
  if (terminalRuntimePlatform() === "electron") {
    const bridge = (window as unknown as { pos?: { readTerminalConfig?: () => Promise<unknown> } }).pos;
    if (typeof bridge?.readTerminalConfig === "function") {
      const originalBinding = binding(registration);
      let result: unknown;
      try { result = await bridge.readTerminalConfig(); }
      catch { throw new NativeTerminalProofError("EAUTH_UNAVAILABLE", 503); }
      const response = object(result);
      if (response?.ok !== true) throw new NativeTerminalProofError("EAUTH_UNAVAILABLE", 503);
      const native = object(response.config);
      if (!native?.tokenId || binding(native) !== originalBinding || binding(readTerminalConfig()) !== originalBinding) return refuse();
      const nativeProof = native.deviceBindingProof;
      if (typeof nativeProof === "string" && /^[a-f0-9]{64}$/i.test(nativeProof)) saved = nativeProof;
      else if (nativeProof !== undefined && nativeProof !== null && nativeProof !== "") return refuse();
    }
  }
  const proof = typeof saved === "string" && /^[a-f0-9]{64}$/i.test(saved)
    ? saved.toLowerCase()
    : await deviceProofHash();
  return {
    terminalToken: registration.tokenId,
    ...(proof ? { deviceBindingProof: proof } : {}),
  };
}
