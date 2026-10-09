/**
 * Builds the Windows installer + update manifest into ./release.
 *
 * The update feed URL comes from POS_UPDATE_URL (the plain web folder that
 * will host "Retail Setup <version>.exe" + latest.yml). A placeholder is
 * used when it is unset so local builds still succeed.
 *
 * The installer is handed to other shops, so it must carry no web deployment
 * configuration. Web environment names are removed from the build environment
 * here (see scripts/web-only-env.cjs) and vite.config.ts loads no .env file
 * for a DESKTOP_BUILD.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { withoutWebEnv } = require("./web-only-env.cjs");

const root = path.resolve(__dirname, "..");

const DEFAULT_URL = "https://updatecms.luckycharmsdnbhd.com/pos-app/latest/";
const url = (process.env.POS_UPDATE_URL || "").trim() || DEFAULT_URL;
if (!process.env.POS_UPDATE_URL) {
  console.log(`POS_UPDATE_URL is not set — baking in the default feed ${url}`);
}

const env = { ...withoutWebEnv(), POS_UPDATE_URL: url, DESKTOP_BUILD: "1" };

const run = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
};

function prepareCachedElectronRuntime() {
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return null;
  const electronVersion = require(path.join(root, "node_modules", "electron", "package.json")).version;
  const archiveName = `electron-v${electronVersion}-win32-x64.zip`;
  const cacheRoot = path.join(process.env.LOCALAPPDATA, "electron", "Cache");
  if (!fs.existsSync(cacheRoot)) return null;
  const archive = fs
    .readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(cacheRoot, entry.name, archiveName))
    .find((candidate) => fs.existsSync(candidate));
  if (!archive) return null;

  const runtime = path.join(root, "release", "electron-runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const extracted = spawnSync("tar.exe", ["-xf", archive, "-C", runtime], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env,
  });
  if (extracted.error) throw extracted.error;
  if (extracted.status !== 0 || !fs.existsSync(path.join(runtime, "electron.exe"))) {
    throw new Error("Could not prepare the cached Electron runtime");
  }
  return runtime;
}


// A stale bundle from an earlier (web-flavoured) build must never be packaged.
console.log("› clearing stale desktop output");
for (const dir of ["dist-desktop", "release"]) {
  fs.rmSync(path.join(root, dir), { recursive: true, force: true });
}

run(path.join(root, "scripts", "bump-version.cjs"), ["--write"]);
// Settings downloads and automatic upgrades consume this exact bundled file.
// Regenerate before packaging so a new application cannot ship stale SQL.
for (const script of ["supabase-registry-report.cjs", "generate-sqlserver-schema.cjs", "verify-sqlserver-schema.cjs", "verify-sync-registry.cjs", "test-database-upgrade.cjs"])
  run(path.join(root, "scripts", script), []);
run(path.join(root, "node_modules", "vite", "bin", "vite.js"), ["build"]);

// Electron loads dist-desktop/server/index.mjs. Some toolchain versions ignore
// the configured output directory and write to dist/, which would package an
// app with no server entry — normalise it here.
const desktopOut = path.join(root, "dist-desktop");
const genericOut = path.join(root, "dist");
if (!fs.existsSync(desktopOut) && fs.existsSync(genericOut)) {
  console.log("› moving dist/ into dist-desktop/ for packaging");
  fs.renameSync(genericOut, desktopOut);
}
if (!fs.existsSync(path.join(desktopOut, "server", "index.mjs"))) {
  console.error("Desktop build produced no dist-desktop/server/index.mjs — aborting.");
  process.exit(1);
}

const builderArgs = [
  "--win",
  "nsis",
  "--publish",
  "never",
];
const electronRuntime = prepareCachedElectronRuntime();
if (electronRuntime) builderArgs.push(`--config.electronDist=${electronRuntime}`);
run(path.join(root, "node_modules", "electron-builder", "cli.js"), builderArgs);

console.log("✓ Windows installer ready in release/");
