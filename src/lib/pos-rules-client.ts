import { hostedFunction } from "./hosted-function-client";
import { getPosRules as getPosRulesDirect, savePosRules as savePosRulesDirect, verifyManagerPin as verifyManagerPinDirect, assertShiftClosable as assertShiftClosableDirect } from "./pos-rules.functions";
export const getPosRules = hostedFunction("pos-rules.getPosRules", getPosRulesDirect);
export const savePosRules = hostedFunction("pos-rules.savePosRules", savePosRulesDirect);
export const verifyManagerPin = hostedFunction("pos-rules.verifyManagerPin", verifyManagerPinDirect);
export const assertShiftClosable = hostedFunction("pos-rules.assertShiftClosable", assertShiftClosableDirect);
