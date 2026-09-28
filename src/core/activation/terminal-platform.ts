import { platformName } from "@/platform-config/platform";

/** Device family encoded into a one-time activation token. */
export type TerminalPlatform = "pc" | "mobile";

/** Runtime identity accepted by the terminal claim RPC. */
export type TerminalRuntimePlatform =
  | ReturnType<typeof platformName>
  | "server";

/**
 * Identify the shell once, using the shared platform detector.
 *
 * Electron can also have Capacitor's web shim on `window`. The shared detector
 * deliberately checks native Android/iOS first and then the Electron preload,
 * so that harmless `Capacitor.getPlatform() === "web"` value cannot turn a PC
 * terminal into a browser during activation.
 */
export function terminalRuntimePlatform(): TerminalRuntimePlatform {
  if (typeof window === "undefined") return "server";
  return platformName();
}

/** Map a claim runtime to the token family it is allowed to redeem. */
export function tokenPlatformForRuntime(
  runtime: TerminalRuntimePlatform,
): TerminalPlatform | null {
  if (runtime === "electron") return "pc";
  if (runtime === "android") return "mobile";
  return null;
}

export function canRuntimeClaimToken(
  token: TerminalPlatform,
  runtime: TerminalRuntimePlatform,
): boolean {
  return tokenPlatformForRuntime(runtime) === token;
}
