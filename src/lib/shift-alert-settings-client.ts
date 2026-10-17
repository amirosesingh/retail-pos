import { hostedFunction } from "./hosted-function-client";
import { saveGlobalShiftAlerts as saveGlobalShiftAlertsDirect } from "./shift-alert-settings.functions";
export const saveGlobalShiftAlerts = hostedFunction("shift-alert-settings.saveGlobalShiftAlerts", saveGlobalShiftAlertsDirect);
