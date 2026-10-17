import { hostedFunction } from "./hosted-function-client";
import { readSessionPermissions as readSessionPermissionsDirect } from "./session-permissions.functions";
export const readSessionPermissions = hostedFunction("session-permissions.readSessionPermissions", readSessionPermissionsDirect);
