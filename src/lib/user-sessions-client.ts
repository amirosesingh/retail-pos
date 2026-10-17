import { hostedFunction } from "./hosted-function-client";
import { startDeviceSession as startDeviceSessionDirect, endDeviceSession as endDeviceSessionDirect, recordDeviceActivity as recordDeviceActivityDirect, listDeviceSessions as listDeviceSessionsDirect, revokeDeviceSessions as revokeDeviceSessionsDirect } from "./user-sessions.functions";
export type { DeviceSession } from "./user-sessions.functions";
export const startDeviceSession = hostedFunction("user-sessions.startDeviceSession", startDeviceSessionDirect);
export const endDeviceSession = hostedFunction("user-sessions.endDeviceSession", endDeviceSessionDirect);
export const recordDeviceActivity = hostedFunction("user-sessions.recordDeviceActivity", recordDeviceActivityDirect);
export const listDeviceSessions = hostedFunction("user-sessions.listDeviceSessions", listDeviceSessionsDirect);
export const revokeDeviceSessions = hostedFunction("user-sessions.revokeDeviceSessions", revokeDeviceSessionsDirect);
