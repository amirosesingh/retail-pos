import { hostedFunction } from "./hosted-function-client";
import { deleteEmptyLocation as deleteEmptyLocationDirect } from "./location-admin.functions";
export type { LocationDeleteResult } from "./location-admin.functions";
export const deleteEmptyLocation = hostedFunction("location-admin.deleteEmptyLocation", deleteEmptyLocationDirect);
