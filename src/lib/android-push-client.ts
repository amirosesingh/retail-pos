import { hostedFunction } from "./hosted-function-client";
import { updateAndroidPushDevice as updateAndroidPushDeviceDirect } from "./android-push.functions";
export const updateAndroidPushDevice = hostedFunction("android-push.updateAndroidPushDevice", updateAndroidPushDeviceDirect);
