import { hostedFunction } from "./hosted-function-client";
import { startMemberVerification as startMemberVerificationDirect, confirmMemberVerification as confirmMemberVerificationDirect, getVerificationSettings as getVerificationSettingsDirect, saveVerificationSettings as saveVerificationSettingsDirect, listMemberVerifications as listMemberVerificationsDirect } from "./verification.functions";
export const startMemberVerification = hostedFunction("verification.startMemberVerification", startMemberVerificationDirect);
export const confirmMemberVerification = hostedFunction("verification.confirmMemberVerification", confirmMemberVerificationDirect);
export const getVerificationSettings = hostedFunction("verification.getVerificationSettings", getVerificationSettingsDirect);
export const saveVerificationSettings = hostedFunction("verification.saveVerificationSettings", saveVerificationSettingsDirect);
export const listMemberVerifications = hostedFunction("verification.listMemberVerifications", listMemberVerificationsDirect);
