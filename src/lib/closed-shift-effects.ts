import type { ShiftCloseSyncResult } from "./shift-closing";

/** A committed closure must get its print attempt even when synchronization fails. */
export async function closedShiftEffects({ print, synchronize }: {
  print: () => Promise<{ ok: boolean; error?: string }>;
  synchronize: () => Promise<ShiftCloseSyncResult>;
}) {
  let printed: { ok: boolean; error?: string };
  try { printed = await print(); }
  catch (error) { printed = { ok: false, error: String(error instanceof Error ? error.message : error) }; }
  let synchronized: ShiftCloseSyncResult;
  try { synchronized = await synchronize(); }
  catch (error) { synchronized = { ok: false, error: String(error instanceof Error ? error.message : error) }; }
  return { printed, synchronized };
}
