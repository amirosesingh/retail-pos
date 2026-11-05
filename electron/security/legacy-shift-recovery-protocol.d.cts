export const ACTION: 'LEGACY_CLOSING_RECOVERY_V1';
export const MAX_UPLOAD_BYTES: number;
export type LegacyRecoveryPayload = {
  version: 1; recoveryId: string; branchId: string; terminalId: string; shiftId: string;
  evidenceHash: string; cloudWitnessHash: string; reason: string; localGraphText: string; cloudGraphText: string;
  financialVerification: 'UNVERIFIED_HISTORICAL';
};
export type UnsignedLegacyRecovery = {
  version: 1; algorithm: 'Ed25519'; keyId: string; projectOrigin: string; terminalId: string; authorId: string;
  subject: string; branchId: string; shiftId: string; recoveryId: string; action: 'LEGACY_CLOSING_RECOVERY_V1'; payloadHash: string;
};
export type LegacyRecoveryAttestation = UnsignedLegacyRecovery & {signature: string};
export function normalizeLegacyPayload(input: unknown): LegacyRecoveryPayload;
export function unsignedLegacyRecovery(input: unknown): UnsignedLegacyRecovery;
export function normalizeLegacyRecovery(input: unknown): LegacyRecoveryAttestation;
export function legacyRecoveryMessage(input: unknown): string;
export function legacyRecoveryWire(payloadJson: string, attestation: unknown): string;
