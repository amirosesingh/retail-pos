/** Activation summaries show the origin only, never URL credentials or keys. */
export function registrationOrigin(value?: string) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : "Not configured";
  } catch { return "Not configured"; }
}
