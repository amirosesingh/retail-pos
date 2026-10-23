/** Run before client modules: dependencies can import Zod without our wrapper. */
export const zodCspBootScript =
  "globalThis.__zod_globalConfig=Object.assign(globalThis.__zod_globalConfig||{},{jitless:true});";
