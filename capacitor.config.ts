import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android wrapper for the POS.
 *
 * The whole app ships inside the APK (see scripts/mobile-build.cjs), so the
 * phone never needs a server to start — it works fully offline and only talks
 * to the cloud to sync. Set POS_MOBILE_URL only when you deliberately want a
 * thin shell that loads a hosted site instead.
 */
const remote = process.env["POS_MOBILE_URL"];

const config: CapacitorConfig = {
  appId: process.env.POS_RELEASE_CHANNEL === "beta" ? "com.luckycharms.pos.beta" : "com.luckycharms.pos",
  appName: process.env.POS_RELEASE_CHANNEL === "beta" ? "Retail Beta" : "Retail",
  webDir: "capacitor-shell",
  ...(remote
    ? { server: { url: remote, cleartext: false, androidScheme: "https" } }
    : { server: { androidScheme: "https" } }),
  plugins: {
    SystemBars: { insetsHandling: "native", initialViewportFitValueHint: "contain" },
  },
  android: {
    allowMixedContent: false,
    zoomEnabled: false,
  },
};

export default config;
