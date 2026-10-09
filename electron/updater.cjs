/**
 * Background auto-update for the Windows till.
 *
 * The feed is configured at build time through POS_UPDATE_FEED:
 *   - "github"                          → GitHub releases (POS_UPDATE_REPO="owner/name")
 *   - any https URL                     → generic static folder hosting the
 *                                         installer + latest.yml
 * Updates download in the background and are only applied when the operator
 * restarts, so a shift is never interrupted.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, net } = require("electron");
const netHttp = require("./net.cjs");



/** Update folder used when nothing else is configured or baked in. */
const DEFAULT_FEED_URL = "https://updatecms.luckycharmsdnbhd.com/pos-app/latest/";

let autoUpdater = null;
let state = {
  status: "idle",
  version: app.getVersion(),
  percent: 0,
  error: null,
  /** Where it went wrong: check | download | verify | install. */
  stage: null,
  /** Raw network/library message, kept for the "Copy details" button. */
  detail: null,
  code: null,
  url: null,
};
let started = false;
let checkPromise = null;
let downloadPromise = null;
let installing = false;
let installFailureHandler = () => {};
const preferencesFile = () => path.join(app.getPath("userData"), "update-preferences.json");
function preferences() { try { return JSON.parse(fs.readFileSync(preferencesFile(), "utf8")); } catch { return {}; } }
function savePreferences(patch) {
  const file = preferencesFile();
  const temporary = file + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify({ ...preferences(), ...patch }));
  fs.renameSync(temporary, file);
}
function log(level, ...values) {
  const line = `${new Date().toISOString()} ${level} ${values.map(value => String(value)).join(" ")}\n`;
  console[level === "error" ? "error" : "info"]("[updater]", ...values);
  try {
    const file = path.join(app.getPath("userData"), "updater.log");
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file + ".previous");
    fs.appendFileSync(file, line);
  } catch { /* logging never blocks trading */ }
}
let paused = false;


function cleanupFallbackInstallers(except = null) {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!/^pos-(?:update|rollback)-.+\.exe$/i.test(name)) continue;
      const file = path.join(os.tmpdir(), name);
      if (except && path.resolve(file) === path.resolve(except)) continue;
      try { fs.rmSync(file, { force: true }); removed += 1; } catch { /* a running installer is retried next launch */ }
    }
  } catch {
    /* temporary-folder cleanup is best-effort */
  }
  return removed;
}


function broadcast() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("update:status", state);
  }
}

function set(patch) {
  if (patch.status && patch.status !== state.status) log("info", patch.status, patch.stage ?? "", patch.available ?? state.available ?? "");
  state = { ...state, ...patch };
  broadcast();
}

function feed() {
  const configured = (process.env.POS_UPDATE_FEED || "").trim();
  if (!configured) return bakedFeed() || { provider: "generic", url: DEFAULT_FEED_URL };
  if (configured.toLowerCase() === "github") {
    const repo = (process.env.POS_UPDATE_REPO || "").trim();
    if (!repo.includes("/")) return null;
    const [owner, name] = repo.split("/");
    return { provider: "github", owner, repo: name };
  }
  if (/^https?:\/\//i.test(configured)) return { provider: "generic", url: configured };
  return null;
}

/**
 * Feed baked into the installer at build time (electron-builder writes
 * app-update.yml from the `build.publish` config). Used when no
 * POS_UPDATE_FEED env var overrides it.
 */
function bakedFeed() {
  try {
    const file = path.join(process.resourcesPath || "", "app-update.yml");
    const text = fs.readFileSync(file, "utf8");
    const url = /^\s*url:\s*(.+)\s*$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "");
    const owner = /^\s*owner:\s*(.+)\s*$/m.exec(text)?.[1]?.trim();
    const repo = /^\s*repo:\s*(.+)\s*$/m.exec(text)?.[1]?.trim();
    if (owner && repo) return { provider: "github", owner, repo };
    if (url && /^https?:\/\//i.test(url) && !/updates\.example\.com/i.test(url))
      return { provider: "generic", url };
  } catch {
    /* not packaged, or no feed baked in */
  }
  return null;
}

function load() {
  if (autoUpdater) return autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    set({ status: "unavailable", error: "Auto-update is not bundled in this build." });
    return null;
  }
  const target = feed();
  if (!target) {
    set({ status: "unavailable", error: "No update feed is configured for this build." });
    autoUpdater = null;
    return null;
  }
  // The manager owns the automatic download so all callers share one promise.
  autoUpdater.autoDownload = false;
  autoUpdater.logger = { info: (...args) => log("info", ...args), warn: (...args) => log("warn", ...args), error: (...args) => log("error", ...args), debug: (...args) => log("info", ...args) };
  autoUpdater.autoInstallOnAppQuit = false;
  // Reuse unchanged installer blocks; electron-updater falls back to the
  // full installer if the cache, blockmaps or range requests are unavailable.
  autoUpdater.disableDifferentialDownload = false;
  // Keep manifests fresh and ask proxies/CDNs not to transform installer bytes.
  // A transformed body is particularly unsafe when a retry resumes by Range.
  autoUpdater.requestHeaders = {
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Accept-Encoding": "identity",
  };
  autoUpdater.setFeedURL(target);
  autoUpdater.on("checking-for-update", () =>
    set({ status: "checking", error: null, stage: null, detail: null, code: null }),
  );
  autoUpdater.on("update-not-available", () => set({ status: "current", percent: 0, error: null }));
  autoUpdater.on("update-available", (info) => {
    if (preferences().blockedVersion === info?.version) {
      set({ status: "unavailable", available: info.version, error: "This version was rolled back. Maintenance approval is required before retrying it." });
      return;
    }
    set({ status: "available", percent: 0, available: info?.version ?? null });
  });
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent || 0), transferred: p.transferred, total: p.total }));
  autoUpdater.on("update-downloaded", (info) =>
    set({ status: "ready", percent: 100, available: info?.version ?? null, error: null, stage: null }),
  );
  autoUpdater.on("error", (err) => {
    const raw = String(err?.message || err);
    const { code, friendly } = netHttp.explainNetworkError(raw);
    const stage = installing ? "install" : state.status === "downloading" ? "download" : "check";
    set({ status: "error", stage, code, detail: raw, error: friendly });
    if (stage === "install") { installing = false; installFailureHandler(); }

  });
  return autoUpdater;
}

/** One automatic check per launch; explicit Settings retries are coalesced. */
function check() {
  if (checkPromise) return checkPromise;
  if (paused || installing || ["ready", "downloading"].includes(state.status)) return Promise.resolve(state);
  const updater = load();
  if (!updater) return Promise.resolve(state);
  if (!app.isPackaged) {
    set({ status: "unavailable", error: "Updates only run in the installed app." });
    return Promise.resolve(state);
  }
  checkPromise = (async () => {
    try {
      await updater.checkForUpdates();
      if (state.status === "available") await downloadUpdate();
    } catch (err) {
      const raw = String(err?.message || err);
      const { code, friendly } = netHttp.explainNetworkError(raw);
      set({ status: "error", stage: "check", code, detail: raw, error: friendly, url: manifestish() });
    }
    return state;
  })().finally(() => { checkPromise = null; });
  return checkPromise;
}

/** electron-updater owns cache validation, differential download and full fallback. */
function downloadUpdate() {
  if (downloadPromise) return downloadPromise;
  const updater = load();
  if (!updater || paused || installing || !state.available || !["available", "error"].includes(state.status)) return Promise.resolve(state);
  downloadPromise = (async () => {
    try {
      set({ status: "downloading", percent: 0, error: null, stage: "download" });
      await updater.downloadUpdate();
    } catch (err) {
      const raw = String(err?.message || err);
      const { code, friendly } = netHttp.explainNetworkError(raw);
      set({ status: "error", stage: "download", code, detail: raw, error: friendly });
    }
    return state;
  })().finally(() => { downloadPromise = null; });
  return downloadPromise;
}

/** The address the check reads, used in error reports and the test button. */
function manifestish() {
  const target = feed();
  if (!target) return null;
  if (target.provider === "github")
    return `https://github.com/${target.owner}/${target.repo}/releases/latest`;
  return `${target.url.replace(/\/+$/, "")}/latest.yml`;
}

/** Direct installer address for a version on the configured feed. */
function installerUrl(version) {
  return version ? rollbackUrl(version) : null;
}

/** Contact the update folder and report exactly what the server answered. */
async function diagnose() {
  const target = feed();
  const base = target?.provider === "generic" ? target.url.replace(/\/+$/, "") : null;
  const checks = [];
  const addresses = [
    manifestish(),
    base ? `${base}/manifest.json` : null,
    installerUrl(state.available),
  ].filter(Boolean);
  for (const url of addresses) checks.push(await netHttp.probe(url));
  return {
    ok: checks.some((c) => c.ok),
    version: app.getVersion(),
    feed: base ?? (target ? `${target.owner}/${target.repo}` : null),
    checks,
  };
}

function install() {
  if (installing) return { ok: true };
  if (state.status !== "ready" || !autoUpdater) return { ok: false, error: "No update is ready." };
  installing = true;
  try {
    // Supported NSIS lifecycle. Errors emitted synchronously are reflected in state.
    autoUpdater.quitAndInstall(true, true);
    if (state.status === "error") throw new Error(state.error);
    return { ok: true };
  } catch (error) {
    installing = false;
    set({ status: "error", stage: "install", error: String(error?.message || error) });
    return { ok: false, error: state.error };
  }
}

/** Address a counter can open in a browser when everything else failed. */
const downloadPage = () => installerUrl(state.available);


function start() {
  if (paused || started) return;
  started = true;
  void check();
}

// No periodic update polling. Downloads remain staged in electron-updater's cache.
function stop() {}

/** Safe mode calls this so a broken build cannot keep reinstalling itself. */
function pause() {
  paused = true;
  stop();
}

/**
 * A launch that reached the till proves the build works, so automatic updates
 * come back on their own — a single bad start can no longer pause them for ever.
 */
function resume(clearBlockedVersion = false) {
  if (clearBlockedVersion) savePreferences({ blockedVersion: null });
  if (!paused) return { ok: true, resumed: false };
  paused = false;
  set({ status: "idle", error: null });
  start();
  return { ok: true, resumed: true };
}

const isPaused = () => paused;

/* ------------------------------ rollback ------------------------------ */

const PRODUCT_NAME = "Retail";
const artifact = (version) => `${PRODUCT_NAME} Setup ${version}.exe`;

/** Where the installer for a given version lives on the configured feed. */
function rollbackUrl(version) {
  const target = feed();
  if (!target) return null;
  const file = encodeURIComponent(artifact(version));
  if (target.provider === "github") {
    return `https://github.com/${target.owner}/${target.repo}/releases/download/v${version}/${file}`;
  }
  return `${target.url.replace(/\/+$/, "")}/${file}`;
}

function download(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: "follow" });
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed (HTTP ${response.statusCode})`));
        response.resume?.();
        return;
      }
      const total = Number(response.headers["content-length"] || 0);
      let received = 0;
      const out = fs.createWriteStream(destination);
      response.on("data", (chunk) => {
        received += chunk.length;
        out.write(chunk);
        if (total && onProgress) onProgress(Math.round((received / total) * 100));
      });
      response.on("end", () => out.end(() => resolve(destination)));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

/** Read a small text file off the update feed; null when it is not published. */
function fetchText(url) {
  return new Promise((resolve) => {
    let timer;
    const finish = value => { clearTimeout(timer); resolve(value); };
    try {
      const request = net.request({ url, redirect: "follow" });
      timer = setTimeout(() => { finish(null); request.abort(); }, 15000);
      request.on("response", (response) => {
        if (response.statusCode !== 200) {
          response.resume?.();
          finish(null);
          return;
        }
        let body = "";
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) { finish(null); request.abort(); return; }
          body += chunk.toString("utf8");
        });
        response.on("end", () => finish(body));
        response.on("error", () => finish(null));
      });
      request.on("error", () => finish(null));
      request.end();
    } catch {
      finish(null);
    }
  });
}

async function history() {
  try {
    const target = feed();
    if (target?.provider !== 'generic') return { ok: false, releases: [], error: 'Release history is unavailable for this feed.' };
    const base = target.url.replace(/\/+$/, '').replace(/\/latest$/, '');
    const raw = await fetchText(`${base}/releases.json`);
    if (!raw) return { ok: false, releases: [], error: 'Release history could not be loaded. Your current version remains available.' };
    return { ok: true, releases: require('./update-history.cjs').parseHistory(raw) };
  } catch { return { ok: false, releases: [], error: 'The release history is invalid.' }; }
}

/**
 * The publisher's sha512 for an earlier installer, taken from the release
 * manifest the build pipeline uploads next to it. electron-builder writes one
 * `<version>.yml` per release for generic feeds; a plain `<artifact>.sha512`
 * sidecar is honoured too.
 */
async function publishedHash(version) {
  const target = feed();
  if (!target || target.provider !== "generic") return null;
  const base = target.url.replace(/\/+$/, "");
  const file = encodeURIComponent(artifact(version));

  const sidecar = await fetchText(`${base}/${file}.sha512`);
  if (sidecar && sidecar.trim()) return sidecar.trim().split(/\s+/)[0];

  // The stable feed publishes electron-builder's latest.yml. Some providers
  // additionally retain a version-named manifest, so support that as a
  // fallback for rollbacks without requiring it for normal updates.
  for (const name of ["latest.yml", `${encodeURIComponent(version)}.yml`]) {
    const manifest = await fetchText(`${base}/${name}`);
    if (!manifest || !manifest.includes(artifact(version))) continue;
    const hash = /^\s*sha512:\s*(.+)\s*$/m
      .exec(manifest)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (hash) return hash;
  }
  return null;
}

/** base64 sha512 of a file, in the same encoding electron-builder publishes. */
function fileHash(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
    stream.on("error", reject);
  });
}

/**
 * Windows Authenticode check. Used as the second proof when the feed publishes
 * no hash: an installer that is not validly signed never runs.
 */
function authenticodeSigner(file) {
  return new Promise((resolve) => {
    try {
      const ps = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$s = Get-AuthenticodeSignature -LiteralPath ${"'" + file.replaceAll("'", "''") + "'"}; ` +
            `Write-Output ($s.Status.ToString() + '|' + $s.SignerCertificate.Subject)`,
        ],
        { windowsHide: true },
      );
      let out = "";
      ps.stdout.on("data", (chunk) => {
        out += chunk.toString("utf8");
      });
      ps.on("error", () => resolve(null));
      ps.on("close", () => {
        const [status, ...rest] = out.trim().split("|");
        if (!status) return resolve(null);
        resolve({ status: status.trim(), subject: rest.join("|").trim() });
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Maintenance rollback requires both the published SHA512 and a valid
 * Authenticode signature matching the configured publisher. Routine updates
 * use electron-updater's supported verification and installation lifecycle.
 */
async function verifyInstaller(file, version) {
  const expected = await publishedHash(version);
  if (expected) {
    const actual = await fileHash(file).catch(() => null);
    if (!actual) return { ok: false, error: "The downloaded installer could not be read." };
    const a = Buffer.from(actual, "base64");
    const b = Buffer.from(expected, "base64");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
      return {
        ok: false,
        error: "The downloaded installer does not match the published release. It was discarded.",
      };
    // A checksum proves bytes; Windows must also verify the publisher.
  }

  const signature = await authenticodeSigner(file);
  if (!signature)
    return {
      ok: false,
      error: "This installer could not be verified (no published checksum and no signature check).",
    };
  if (signature.status !== "Valid")
    return {
      ok: false,
      error: `This installer is not validly signed (${signature.status}). It was discarded.`,
    };
  let publishers = [];
  try {
    const config = require("js-yaml").load(fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8"));
    publishers = Array.isArray(config.publisherName) ? config.publisherName : config.publisherName ? [config.publisherName] : [];
  } catch { /* optional environment pin below */ }
  const publisher = (process.env.POS_UPDATE_PUBLISHER || "").trim();
  if (publisher) publishers = [publisher];
  if (!publishers.length) return { ok: false, error: "Maintenance rollback requires a configured trusted publisher." };
  if (!publishers.some(name => signature.subject.split(/,\s*/).some(part => part.toLowerCase() === `cn=${String(name).toLowerCase()}`)))
    return {
      ok: false,
      error: "This installer is signed by an unexpected publisher. It was discarded.",
    };
  return { ok: true, proof: "signature" };
}

/**
 * Fetch the installer for an earlier version, prove it came from us, and only
 * then run it silently. NSIS reinstalls in place, so the user-data folder —
 * activation mirror, settings, local database pointer — is left alone.
 */
async function rollback(version, onProgress) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) return { ok: false, error: "A stable earlier version is required." };
  if (process.platform !== "win32")
    return { ok: false, error: "Roll back is only supported on Windows." };
  const url = rollbackUrl(version);
  if (!url) return { ok: false, error: "No update feed is configured for this build." };
  if (!/^https:\/\//i.test(url))
    return { ok: false, error: "The update feed is not served over a secure connection." };
  const file = path.join(os.tmpdir(), `pos-rollback-${version}.exe`);
  cleanupFallbackInstallers(file);
  try {
    await download(url, file, onProgress);
  } catch (err) {
    try { fs.rmSync(file, { force: true }); } catch { /* next launch cleans it */ }
    return { ok: false, error: `Could not download version ${version}: ${err?.message || err}` };
  }
  const verified = await verifyInstaller(file, version);
  if (!verified.ok) {
    fs.rm(file, { force: true }, () => {});
    return { ok: false, error: verified.error };
  }
  try {
    savePreferences({ blockedVersion: app.getVersion() });
    spawn(file, ["/S"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch (err) {
    return { ok: false, error: `Could not start the installer: ${err?.message || err}` };
  }
  setTimeout(() => app.quit(), 1500);
  return { ok: true, version, verifiedBy: verified.proof };
}


module.exports = {
  history,
  onInstallFailure: (handler) => { installFailureHandler = handler; },
  start,
  stop,
  pause,
  resume,
  isPaused,
  check,
  downloadUpdate,
  install,
  rollback,
  diagnose,
  cleanupFallbackInstallers,
  downloadPage,
  status: () => state,
};
