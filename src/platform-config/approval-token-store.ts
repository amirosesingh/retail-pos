// Native mobile implementation; web uses the no-op approval client.
export async function approvalTokenStore() {
 const { SecureStoragePlugin } = await import("capacitor-secure-storage-plugin");
 return SecureStoragePlugin;
}
