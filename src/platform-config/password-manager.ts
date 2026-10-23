/** Browser and desktop builds never include native password-manager bridges. */
export const hasNativePasswordManager = false;
export async function requestSavedLogin(): Promise<{ username: string; password: string } | null> {
  return null;
}
export async function offerSaveLogin(_username: string, _password: string): Promise<void> {}
