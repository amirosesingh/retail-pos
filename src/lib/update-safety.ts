/** Renderer-only checkout state. Main independently guards writes and printing. */
let ticket = false;
let operations = 0;
export const setUpdateTicketBusy = (busy: boolean) => { ticket = busy; };
export const updateRestartSafe = () => !ticket && operations === 0;
export function beginUpdateOperation() {
  operations += 1;
  let ended = false;
  return () => { if (!ended) { ended = true; operations -= 1; } };
}
