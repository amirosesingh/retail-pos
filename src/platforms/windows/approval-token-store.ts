import { desktopBridge } from "@/lib/desktop-bridge-registry";
export async function approvalTokenStore() {
 const bridge = desktopBridge("pos", window.pos ?? null);
 if (!bridge?.approvalTokenVault) throw new Error("Update the Windows app to enable secure approval-token storage.");
 const call = async (operation: "get" | "set" | "remove", key: string, value?: string) => {
  const result = await bridge.approvalTokenVault!(operation, key, value);
  if (!result.ok) throw new Error(result.error || "Windows approval-token storage failed");
  return result.value;
 };
 return {
  get: async ({ key }: { key: string }) => ({ value: String(await call("get", key)) }),
  set: async ({ key, value }: { key: string; value: string }) => ({ value: await call("set", key, value) !== false }),
  remove: async ({ key }: { key: string }) => ({ value: await call("remove", key) !== false }),
 };
}
