import type { ReactNode } from "react";

/** Build-time adapters for shell UI that does not exist on this target. */
export function NativeBoot({ children }: { children: ReactNode }) { return children; }
export function NativeWindowFrame({ children }: { children: ReactNode }) { return children; }
export function PrivilegeGate({ children }: { children: ReactNode }) { return children; }
export function AndroidPushAgent() { return null; }
export function AndroidUpdateBanner() { return null; }
export function DesktopUpdateBanner() { return null; }
export function DesktopCloseSyncStatus() { return null; }
export function LocalDatabaseWizard(_props: { initiallyOpen?: boolean; onRecoveryClose?: () => void } = {}) { return null; }
export function LocalDatabaseOperations() { return null; }
