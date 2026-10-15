/** Register ticket state shared with native close and update guards. */
import { setUpdateTicketBusy } from "@/lib/update-safety";

/** Set by the register so updates wait for an unfinished ticket. */
export const setTicketDirty = (dirty: boolean) => {
  setUpdateTicketBusy(dirty);
};
