import { deleteEmptyLocation, type LocationDeleteResult } from "./location-admin.functions";
import { getPosCallerAuth } from "./pos-caller-auth";

export async function permanentlyDeleteEmptyLocation(
  storeId: string,
  confirmationName: string,
): Promise<LocationDeleteResult> {
  return deleteEmptyLocation({
    data: { ...(await getPosCallerAuth()), storeId, confirmationName },
  });
}

