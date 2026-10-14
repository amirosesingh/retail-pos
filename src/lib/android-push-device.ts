import { isAndroid } from "@/platform-config/platform";
import { getDeviceSecret, clearDeviceSecret } from "./device-secrets";
export type PhonePushBinding = {
  deviceId: string;
  token: string;
  userId: string;
  email: string;
  tenant: string;
  cloud: string;
};
export const PHONE_PUSH_STATE = "pos.push.state";
let enrollmentGeneration = 0;
let stateWrite: Promise<void> = Promise.resolve();
export const phoneEnrollmentGeneration = () => enrollmentGeneration;
export function enableLocalPhonePush(state: {userId: string; tenantId: string}, generation: number) {
  stateWrite = stateWrite.catch(() => {}).then(async () => {
    if (generation !== enrollmentGeneration) return;
    const {Preferences} = await import("@capacitor/preferences");
    await Preferences.set({key: PHONE_PUSH_STATE,value:JSON.stringify({...state,enabled:true,expiresAt:Date.now()+30*86400000})});
  });
  return stateWrite;
}
export function disableLocalPhonePush() {
  enrollmentGeneration++;
  stateWrite = stateWrite.catch(() => {}).then(async () => {
    const {Preferences} = await import("@capacitor/preferences");
    await Preferences.remove({key: PHONE_PUSH_STATE});
  });
  return stateWrite;
}
export const PHONE_PUSH_BINDING = "android-push-binding";
export async function removePhonePushBinding() {
  if (!isAndroid() || import.meta.env.VITE_ANDROID_PUSH_ENABLED !== "true") return;
  await disableLocalPhonePush();
  const binding = await getDeviceSecret<PhonePushBinding>(PHONE_PUSH_BINDING);
  try {
    if (binding) {
      const { updateAndroidPushDevice } = await import("./android-push.functions");
      const { getPosCallerAuth } = await import("./pos-caller-auth");
      await updateAndroidPushDevice({
        data: { ...(await getPosCallerAuth()), ...binding, action: "remove" },
      });
    }
  } finally {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.unregister().catch(() => {});
    await PushNotifications.removeAllDeliveredNotifications().catch(() => {});
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.removeAllDeliveredNotifications().catch(() => {});
    await clearDeviceSecret(PHONE_PUSH_BINDING);
  }
}
