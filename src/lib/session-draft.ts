/** Register-owned database drafts; no ticket payload is persisted in device settings. */
type DraftHandler = (action: "save" | "hold" | "cancel" | "release") => Promise<string | void>;
const handlers = new Set<DraftHandler>();
export function registerSessionDraft(handler: DraftHandler) {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}
export async function flushTicketDrafts(action: Parameters<DraftHandler>[0] = "save") {
  let bill: string | void = undefined;
  for (const handler of handlers) { const result = await handler(action); if (result) bill = result; }
  return bill;
}
let pending: Promise<void> | null = null;
export function preserveSessionDrafts(): Promise<void> {
  if (pending) return pending;
  pending = flushTicketDrafts("hold").then(() => undefined).finally(() => { pending = null; });
  return pending;
}
export const draftTicketId = (branch: string, bill: string) => `D:${branch.toLowerCase()}:${bill}`;
