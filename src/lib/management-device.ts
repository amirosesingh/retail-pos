/** Restored from the sealed registration before startup releases data access. */
let management = false;
export function setManagementDevice(config: { tokenId?: string; locationId?: string | null; deviceUse?: "operations" | "management" } | null): void {
  management = Boolean(config?.tokenId && config.deviceUse === "management" && !config.locationId);
}
export const isManagementDevice = () => management;
