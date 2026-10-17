import { hostedFunction } from "./hosted-function-client";
import { getTerminalAccount as getTerminalAccountDirect } from "./terminal-account.functions";
export const getTerminalAccount = hostedFunction("terminal-account.getTerminalAccount", getTerminalAccountDirect);
