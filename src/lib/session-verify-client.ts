import { hostedFunction } from "./hosted-function-client";
import { verifySession as verifySessionDirect } from "./session-verify.functions";
export const verifySession = hostedFunction("session-verify.verifySession", verifySessionDirect);
