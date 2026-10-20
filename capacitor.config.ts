import otaTrust from "./ios-ota.public.json";
import packageJson from "./package.json";
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
if (process.env.POS_MOBILE_TARGET === "ios" && remote) {
  throw new Error("iOS OTA requires a bundled interface; remove POS_MOBILE_URL before building the IPA.");
}

const config: CapacitorConfig = {
  appId: process.env.POS_RELEASE_CHANNEL === "beta" ? "com.luckycharms.pos.beta" : "com.luckycharms.pos",
  appName: process.env.POS_RELEASE_CHANNEL === "beta" ? "Retail Beta" : "Retail",
  webDir: "capacitor-shell",
  ...(remote
    ? { server: { url: remote, cleartext: false, androidScheme: "https" } }
    : { server: { androidScheme: "https" } }),
  ios: { scheme: "App" },
  plugins: {
    CapacitorUpdater: { autoUpdate: false, appReadyTimeout: 15000, responseTimeout: 120, autoDeletePrevious: false, autoDeleteFailed: false, statsUrl: "", channelUrl: "", updateUrl: "" },
    RetailOtaTrust: otaTrust,
    SystemBars: { insetsHandling: "native", initialViewportFitValueHint: "contain" },
  },
  android: {
    includePlugins: Object.keys(packageJson.dependencies).filter(name => name !== "@capgo/capacitor-updater" && name !== "@retail/ios-ota-trust"),
    allowMixedContent: false,
    zoomEnabled: false,
  },
};

export default config;
