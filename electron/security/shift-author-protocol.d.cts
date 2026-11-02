export type ShiftAuthorBinding = { projectOrigin: string; terminalId: string; authorId: string };
export type ShiftAuthorEnrollment = ShiftAuthorBinding & { version: 1; algorithm: 'Ed25519'; keyId: string; publicKey: string };
export type ShiftAuthorAction = 'ORIGINAL' | 'RECOUNT' | 'VARIANCE';
export type UnsignedShiftAuthorAttestation = ShiftAuthorBinding & {
  version: 1; algorithm: 'Ed25519'; keyId: string; subject: string; branchId: string;
  shiftId: string; intentId: string; action: ShiftAuthorAction; payloadHash: string;
};
export type ShiftAuthorAttestation = UnsignedShiftAuthorAttestation & { signature: string };
export function normalizeBinding(input: unknown): ShiftAuthorBinding;
export function normalizeEnrollment(input: unknown): ShiftAuthorEnrollment;
export function normalizeAttestation(input: unknown): ShiftAuthorAttestation;
export function enrollmentMessage(input: unknown): string;
export function intentMessage(input: unknown): string;

export type UnsignedClosingStartProof = ShiftAuthorBinding & {
  version: 1; algorithm: 'Ed25519'; keyId: string; subject: string; branchId: string;
  shiftId: string; eventId: string; payloadHash: string; payloadJson: string;
};
export type ClosingStartProof = UnsignedClosingStartProof & { signature: string };
export function normalizeClosingStart(input: unknown): ClosingStartProof;
export function closingStartMessage(input: unknown): string;
