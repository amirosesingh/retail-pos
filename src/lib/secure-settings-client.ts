import { hostedFunction } from "./hosted-function-client";
import { saveSecureSetting as saveSecureSettingDirect, listSecureSettings as listSecureSettingsDirect, clearSecureSetting as clearSecureSettingDirect } from "./secure-settings.functions";
export const saveSecureSetting = hostedFunction("secure-settings.saveSecureSetting", saveSecureSettingDirect);
export const listSecureSettings = hostedFunction("secure-settings.listSecureSettings", listSecureSettingsDirect);
export const clearSecureSetting = hostedFunction("secure-settings.clearSecureSetting", clearSecureSettingDirect);
