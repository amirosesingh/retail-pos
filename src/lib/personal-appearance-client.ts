import { hostedFunction } from "./hosted-function-client";
import { loadPersonalAppearance as loadPersonalAppearanceDirect, savePersonalAppearance as savePersonalAppearanceDirect } from "./personal-appearance.functions";
export const loadPersonalAppearance = hostedFunction("personal-appearance.loadPersonalAppearance", loadPersonalAppearanceDirect);
export const savePersonalAppearance = hostedFunction("personal-appearance.savePersonalAppearance", savePersonalAppearanceDirect);
