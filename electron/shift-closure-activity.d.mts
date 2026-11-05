export const SHIFT_CLOSURE_UNCONFIRMED_NOTICE: string;
export function shiftClosureMessageWithoutStatus(message: unknown): string;
export function shiftClosureStatusMessage(message: unknown, notice: string): string;
export function unconfirmedShiftClosureActivityRow<T extends { event_type?: unknown; message?: unknown; meta?: unknown }>(row: T): T;
export function unconfirmedShiftClosureActivity<T extends { type?: unknown; title?: unknown; message?: unknown; meta?: unknown }>(input: T): T;
