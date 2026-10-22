// Do not return a Capacitor proxy from an async function: Promise resolution
// probes `then`, which the native proxy treats as an unimplemented plugin call.
export async function approvalTokenStore() {
  const { SecureStoragePlugin } = await import("capacitor-secure-storage-plugin");
  return {
    get: (options: { key: string }) => SecureStoragePlugin.get(options),
    set: (options: { key: string; value: string }) => SecureStoragePlugin.set(options),
    remove: (options: { key: string }) => SecureStoragePlugin.remove(options),
  };
}
