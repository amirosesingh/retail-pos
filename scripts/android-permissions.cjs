#!/usr/bin/env node
/**
 * Guarantees the generated Android project can scan barcodes and install its
 * own updates.
 *
 * `npx cap add android` writes a stock manifest with neither the camera
 * permission (barcode/QR scanning silently fails) nor permission to launch the
 * package installer (the downloaded APK never opens). It also publishes only a
 * couple of FileProvider folders, so the installer cannot read an APK saved to
 * the external cache. This runs after `cap sync` and patches all three.
 */
const fs = require("node:fs");
const path = require("node:path");

const androidMain = path.resolve(__dirname, "..", "android", "app", "src", "main");
const manifest = path.join(androidMain, "AndroidManifest.xml");

if (!fs.existsSync(manifest)) {
  console.log("· no Android project yet — nothing to patch");
  process.exit(0);
}

/* ------------------------------ manifest ------------------------------ */

const lines = [
  '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '    <uses-permission android:name="android.permission.CAMERA" />',
  '    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />',
  '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
  '    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
];

let xml = fs.readFileSync(manifest, "utf8");
const missing = lines.filter((l) => {
  const name = /android:name="([^"]+)"/.exec(l)[1];
  return !xml.includes(name);
});
if (missing.length) {
  xml = xml.replace("</manifest>", `${missing.join("\n")}\n</manifest>`);
  console.log(`✓ added ${missing.length} manifest entr${missing.length === 1 ? "y" : "ies"}`);
} else {
  console.log("✓ camera and install permissions already present");
}

/* --------------------------- backup policy ---------------------------- */

/**
 * Uninstalling a till must leave nothing behind. Android's Auto Backup would
 * otherwise upload preferences and sealed blobs to the user's Google account
 * and silently restore them onto a reinstalled app, so the "deleted" terminal
 * would come back already activated and already configured.
 */
function setAttr(source, name, value) {
  const attr = `android:${name}="${value}"`;
  if (source.includes(attr)) return source;
  const existing = new RegExp(`\\s*android:${name}="[^"]*"`);
  const stripped = source.replace(existing, "");
  return stripped.replace(/<application\b/, `<application\n        ${attr}`);
}

const before = xml;
xml = setAttr(xml, "allowBackup", "false");
xml = setAttr(xml, "fullBackupContent", "false");
xml = setAttr(xml, "dataExtractionRules", "@xml/data_extraction_rules");
if (xml !== before) console.log("✓ Auto Backup disabled — uninstall leaves nothing behind");

fs.writeFileSync(manifest, xml, "utf8");

const rules = path.join(androidMain, "res", "xml", "data_extraction_rules.xml");
if (!fs.existsSync(rules)) {
  fs.mkdirSync(path.dirname(rules), { recursive: true });
  fs.writeFileSync(
    rules,
    '<?xml version="1.0" encoding="utf-8"?>\n<data-extraction-rules>\n  <cloud-backup>\n    <exclude domain="root" />\n    <exclude domain="file" />\n    <exclude domain="database" />\n    <exclude domain="sharedpref" />\n    <exclude domain="external" />\n  </cloud-backup>\n  <device-transfer>\n    <exclude domain="root" />\n    <exclude domain="file" />\n    <exclude domain="database" />\n    <exclude domain="sharedpref" />\n    <exclude domain="external" />\n  </device-transfer>\n</data-extraction-rules>\n',
    "utf8",
  );
  console.log("✓ data_extraction_rules.xml written (nothing is backed up or transferred)");
}

/* --------------------------- FileProvider ----------------------------- */

/**
 * The package installer is a separate app: it can only read the APK through a
 * `content://` URI, and only if the folder holding it is published here.
 */
const paths = path.join(androidMain, "res", "xml", "file_paths.xml");
const entries = [
  '    <external-cache-path name="external_cache" path="." />',
  '    <cache-path name="cache" path="." />',
  '    <external-path name="external_files" path="." />',
];

if (!fs.existsSync(paths)) {
  fs.mkdirSync(path.dirname(paths), { recursive: true });
  fs.writeFileSync(
    paths,
    `<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android">\n${entries.join("\n")}\n</paths>\n`,
    "utf8",
  );
  console.log("✓ file_paths.xml created with the installer-readable folders");
  process.exit(0);
}

let pathsXml = fs.readFileSync(paths, "utf8");
const needed = entries.filter((e) => !pathsXml.includes(/name="([^"]+)"/.exec(e)[1]));
if (!needed.length) {
  console.log("✓ FileProvider already publishes the update folder");
  process.exit(0);
}
pathsXml = pathsXml.replace("</paths>", `${needed.join("\n")}\n</paths>`);
fs.writeFileSync(paths, pathsXml, "utf8");
console.log("✓ FileProvider updated for the downloaded update file");
