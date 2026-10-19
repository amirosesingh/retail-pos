import type { TerminalConfig } from "@/core/activation/terminal-tokens";
import type { ReactNode } from "react";

/** Browser login/lobby does not contain terminal provisioning screens. */
export function TerminalActivation(_props: { onActivated: (config: TerminalConfig) => void; embedded?: boolean; onActivationStarted?: () => void }) { return null; }
export function TerminalRevokedScreen(_props: { reason?: "revoked" | "missing" }) { return null; }
export function ConnectDatabaseScreen(_props: { cloudConfigured: boolean; onRetry: () => void }) { return null; }
export function EmergencyAccessLink(_props: { className?: string; label?: string }) { return null; }
export function RecoveryHub() { return null; }
export function EmergencyPinGate(_props: { children: ReactNode }) { return null; }
