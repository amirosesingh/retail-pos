/** Clipboard access is only called by explicit user actions. */
export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable. Select the text and copy it manually.");
  await navigator.clipboard.writeText(text);
}

export async function readText(): Promise<string> {
  if (!navigator.clipboard?.readText) throw new Error("Clipboard unavailable. Touch and hold the field to paste.");
  return navigator.clipboard.readText();
}
