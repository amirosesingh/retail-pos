/**
 * One camera gate for every scanner in the app.
 *
 * Android (Capacitor) has to ask MLKit for the runtime permission before the
 * preview will start; the browser asks through getUserMedia. Both paths return
 * the same shape so the scanner UIs can show one clear message when the user
 * says no, instead of failing silently.
 */
export type CameraCheck = { ok: boolean; reason?: string };

/**
 * Android relaunches the app when the camera activity takes memory, so the
 * grant is remembered for the session instead of being re-requested on every
 * scan (each prompt is another chance for the shell to restart).
 */
let granted = false;

export const isNativeApp = () =>
  typeof window !== "undefined" &&
  Boolean(
    (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      ?.isNativePlatform?.(),
  );

const DENIED =
  "Camera access is blocked. Allow the camera for this app in the device settings, then try scanning again.";
const MISSING = "No camera was found on this device — type or paste the code instead.";
const INSECURE =
  "The browser only allows the camera on a secure (https) address. Open the till over https, then try again.";

/** Ask for camera access, returning a human message when it is not available. */
export async function ensureCameraPermission(): Promise<CameraCheck> {
  if (typeof window === "undefined") return { ok: false, reason: MISSING };
  if (granted) return { ok: true };

  if (isNativeApp()) {
    try {
      const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");
      const current = await BarcodeScanner.checkPermissions();
      let state = current.camera;
      if (state !== "granted" && state !== "limited") {
        state = (await BarcodeScanner.requestPermissions()).camera;
      }
      if (state === "granted" || state === "limited") {
        granted = true;
        return { ok: true };
      }
      return { ok: false, reason: DENIED };
    } catch {
      /* plugin unavailable — fall through to the browser path */
    }
  }

  if (!window.isSecureContext && window.location.hostname !== "localhost")
    return { ok: false, reason: INSECURE };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: MISSING };

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    stream.getTracks().forEach((t) => t.stop());
    granted = true;
    return { ok: true };
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "";
    if (name === "NotFoundError" || name === "OverconstrainedError") return { ok: false, reason: MISSING };
    return { ok: false, reason: DENIED };
  }
}

/**
 * Scan one code with the native MLKit reader. Returns null when the platform
 * is not native or the user cancelled, so callers can fall back to the web
 * reader without special-casing errors.
 */
export async function scanOnceNative(): Promise<string | null> {
  if (!isNativeApp()) return null;
  const permission = await ensureCameraPermission();
  if (!permission.ok) throw new Error(permission.reason ?? DENIED);
  const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");
  // No format filter: EAN/UPC, longer Code 128/39, Data Matrix and QR must
  // all remain available to stock, selling, booking and activation flows.
  const { barcodes } = await BarcodeScanner.scan({ autoZoom: true });
  return barcodes[0]?.rawValue?.trim() || null;
}
