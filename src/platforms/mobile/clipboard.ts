import { Clipboard } from "@capacitor/clipboard";

/** Native pasteboard access; never read automatically or retain clipboard contents. */
export async function copyText(text: string): Promise<void> {
  await Clipboard.write({ string: text });
}

export async function readText(): Promise<string> {
  const result = await Clipboard.read();
  if (result.type !== "text/plain" && result.type !== "text/uri-list") {
    throw new Error("The clipboard does not contain text. Copy a token and try again.");
  }
  return result.value;
}
