import { registerPlugin } from "@capacitor/core";
import { isAndroid, isIOS } from "@/platform-config/platform";

type SavedLogin = { username: string; password: string };
type PasswordBridge = {
  requestPassword(): Promise<SavedLogin>;
  savePassword(credentials: SavedLogin): Promise<void>;
};

const android = registerPlugin<PasswordBridge>("PosPasswordAutofill");
const ios = registerPlugin<PasswordBridge>("RetailOtaTrust");

// An OTA web bundle may run inside an older IPA/APK that does not contain the
// new native method. Keep its login screen usable until a new shell is installed.
const nativeHeaders = typeof window === "undefined" ? [] :
  ((window as unknown as { Capacitor?: { PluginHeaders?: Array<{
    name: string; methods?: Array<{ name: string }>;
  }> } }).Capacitor?.PluginHeaders ?? []);
const hasMethod = (plugin: string, method: string) =>
  nativeHeaders.some((header) => header.name === plugin &&
    header.methods?.some((entry) => entry.name === method));

export const hasNativePasswordManager =
  (isAndroid() && hasMethod("PosPasswordAutofill", "requestPassword")) ||
  (isIOS() && hasMethod("RetailOtaTrust", "requestPassword"));

/** The OS owns stored passwords. No account password is written to POS storage. */
export async function requestSavedLogin(): Promise<SavedLogin | null> {
  const bridge = isAndroid() ? android : isIOS() ? ios : null;
  if (!bridge) return null;
  const result = await bridge.requestPassword();
  return result.username && result.password ? result : null;
}

/** Call only after the server has accepted the exact submitted credentials. */
export async function offerSaveLogin(username: string, password: string): Promise<void> {
  if (!username.trim() || !password) return;
  const bridge = isAndroid() ? android : isIOS() ? ios : null;
  if (bridge) await bridge.savePassword({ username: username.trim(), password });
}
