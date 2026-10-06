/**
 * Windows till storage hygiene.
 *
 * The rule the operator asked for:
 *
 *   fresh install  -> nothing remembered
 *   version update -> identity + configuration kept, derived cache dropped
 *   uninstall      -> nothing left behind (handled by the NSIS installer,
 *                     `deleteAppDataOnUninstall`)
 *
 * Everything the till must remember lives in a short, explicit list. Anything
 * else inside `userData` that matches a cache shape is disposable and is
 * pruned on every launch, and completely on the first launch after an update.
 */
const fs = require("node:fs");
const path = require("node:path");

/** Files and folders that carry identity or approved configuration. */
const REQUIRED_ENTRIES = [
  "pos_config.json", // backend address, branch binding, general settings
  "terminal-config.json", // legacy plain activation (migrated, then removed)
  "terminal-config.bin", // sealed terminal activation
  "local-db-config.bin", // sealed SQL Server connection
  "cloud-credentials.bin", // sealed central database URL + key
  "server-keys.bin",
  "emergency-pin.bin",
  "branding.json",
  "health.json",
  "app-version.json", // written by this module
];

/** Chromium / Electron scratch folders. Rebuilt automatically when missing. */
const CACHE_DIRS = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Service Worker",
  "blob_storage",
  "Crashpad",
  "crashDumps",
  "component_crx_cache",
  "Dictionaries",
  "logs",
];

const isRequiredEntry = (name) => REQUIRED_ENTRIES.includes(name);
const isDisposableCacheDir = (name) => !isRequiredEntry(name) && CACHE_DIRS.includes(name);

/** Remove one directory's contents; the folder itself may stay. */
function emptyDir(dir) {
  let removed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    try {
      fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
      removed += 1;
    } catch {
      /* a locked cache file is left for the next launch */
    }
  }
  return removed;
}

/** Drop every disposable cache folder under `userData`. */
function pruneCaches(userData) {
  let removed = 0;
  for (const name of CACHE_DIRS) {
    if (!isDisposableCacheDir(name)) continue;
    removed += emptyDir(path.join(userData, name));
  }
  return removed;
}

function entryBytes(target) {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory()) return stat.size;
    return fs.readdirSync(target).reduce((total, name) => total + entryBytes(path.join(target, name)), 0);
  } catch {
    return 0;
  }
}

/** Byte-level storage report used by Settings; no file contents are exposed. */
function usage(userData) {
  const cacheBytes = CACHE_DIRS.reduce((total, name) => total + entryBytes(path.join(userData, name)), 0);
  const diagnosticBytes = ["crash.log", "crash.log.1", "connection.log", "connection.log.1", "server.log", "server.log.1"]
    .reduce((total, name) => total + entryBytes(path.join(userData, name)), 0);
  const totalBytes = entryBytes(userData);
  return {
    totalBytes,
    cacheBytes,
    diagnosticBytes,
    retainedBytes: Math.max(0, totalBytes - cacheBytes - diagnosticBytes),
  };
}

const markerPath = (userData) => path.join(userData, "app-version.json");

/** The version recorded on the previous launch, or "" on a fresh install. */
function lastVersion(userData) {
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath(userData), "utf8"));
    return typeof parsed?.version === "string" ? parsed.version : "";
  } catch {
    return "";
  }
}

function rememberVersion(userData, version) {
  try {
    fs.writeFileSync(
      markerPath(userData),
      JSON.stringify({ version, at: new Date().toISOString() }, null, 2),
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Called once per launch. On a version change the caches are wiped outright so
 * the new build never runs against assets compiled for the old one; identity
 * and configuration files are never touched either way.
 */
function runOnLaunch(userData, version) {
  const previous = lastVersion(userData);
  const upgraded = previous !== version;
  const removed = pruneCaches(userData);
  if (upgraded) rememberVersion(userData, version);
  return { upgraded, previous, removed };
}

module.exports = {
  REQUIRED_ENTRIES,
  CACHE_DIRS,
  isRequiredEntry,
  isDisposableCacheDir,
  pruneCaches,
  usage,
  lastVersion,
  rememberVersion,
  runOnLaunch,
};
