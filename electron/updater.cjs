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

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Update folder used when nothing else is configured or baked in. */
const DEFAULT_FEED_URL = "https://updatecms.luckycharmsdnbhd.com/pos-app/latest/";

/** How many times a failed check or download is retried before giving up. */
const ATTEMPTS = 3;

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
  /** Installer fetched by the fallback path, run directly on restart. */
  installerFile: null,
};
let timer = null;
let paused = false;
let fallbackRunning = false;


function broadcast() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("update:status", state);
  }
}

function set(patch) {
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
  // Checking, downloading and installing are separate operator decisions.
  // This prevents a background check from consuming bandwidth or staging an
  // installer when the terminal is in the middle of trading.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // Partial ("delta") downloads make many small ranged requests and are the
  // most fragile link in the chain on tills behind security software. One
  // plain file download is slower but far more likely to complete.
  autoUpdater.disableDifferentialDownload = true;
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
  autoUpdater.on("update-available", (info) =>
    set({ status: "available", percent: 0, available: info?.version ?? null }),
  );
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent || 0) }));
  autoUpdater.on("update-downloaded", (info) =>
    set({ status: "ready", percent: 100, available: info?.version ?? null, error: null, stage: null }),
  );
  autoUpdater.on("error", (err) => {
    const raw = String(err?.message || err);
    const { code, friendly } = netHttp.explainNetworkError(raw);
    const stage = state.status === "downloading" ? "download" : "check";
    set({ status: "error", stage, code, detail: raw, error: friendly });
    // A download that failed part-way is retried through our own network
    // layer, which is the path the manifest already uses successfully.
    if (stage === "download") void fallbackDownload();
  });
  return autoUpdater;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function check() {
  const updater = load();
  if (!updater) return state;
  if (paused) return state;
  if (!app.isPackaged) {
    set({ status: "unavailable", error: "Updates only run in the installed app." });
    return state;
  }
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      await updater.checkForUpdates();
      return state;
    } catch (err) {
      const raw = String(err?.message || err);
      const { code, friendly } = netHttp.explainNetworkError(raw);
      set({
        status: "error",
        stage: "check",
        code,
        detail: `${raw} (attempt ${attempt} of ${ATTEMPTS})`,
        error: friendly,
        url: manifestish(),
      });
      if (attempt < ATTEMPTS) await wait(attempt * 2000);
    }
  }
  return state;
}

/** Download and verify the update, but never restart the till. */
async function downloadUpdate() {
  const updater = load();
  if (!updater) return state;
  if (paused) return state;
  if (state.status !== "available" && state.status !== "error") return state;
  try {
    set({ status: "downloading", percent: 0, error: null, stage: "download" });
    await updater.downloadUpdate();
  } catch (err) {
    const raw = String(err?.message || err);
    const { code, friendly } = netHttp.explainNetworkError(raw);
    set({ status: "error", stage: "download", code, detail: raw, error: friendly });
    await fallbackDownload();
  }
  return state;
}

/** Explicit operator choice: finish the verified download, then install. */
async function downloadAndInstall() {
  const downloaded = await downloadUpdate();
  if (downloaded.status !== "ready") {
    return { ok: false, error: downloaded.error || "The update did not finish downloading." };
  }
  return install();
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

/**
 * When the bundled downloader cannot finish, fetch the installer ourselves
 * with resume and retries, prove it came from us, and keep it for restart.
 */
async function fallbackDownload() {
  if (fallbackRunning) return state;
  const version = state.available;
  const url = installerUrl(version);
  if (!version || !url) return state;
  fallbackRunning = true;
  const file = path.join(os.tmpdir(), `pos-update-${version}.exe`);
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      set({
        status: "downloading",
        percent: 0,
        error: null,
        stage: "download",
        detail: `Retrying the download (${attempt} of ${ATTEMPTS})`,
        url,
      });
      try {
        await netHttp.downloadTo(url, file, {
          resume: attempt > 1,
          onProgress: (percent) => set({ status: "downloading", percent }),
        });
        const verified = await verifyInstaller(file, version);
        if (!verified.ok) {
          // Never keep or resume a file that failed integrity verification.
          // Retry from byte zero because the transfer may have ended cleanly
          // at HTTP level while still being truncated or transformed.
          try {
            fs.rmSync(file, { force: true });
          } catch {
            /* the next download still opens with flags=w when no partial remains */
          }
          set({
            status: "error",
            stage: "verify",
            error: verified.error,
            detail: `${verified.error} (attempt ${attempt} of ${ATTEMPTS})`,
            url,
          });
          if (attempt < ATTEMPTS) {
            await wait(attempt * 3000);
            continue;
          }
          return state;
        }
        set({
          status: "ready",
          percent: 100,
          error: null,
          stage: null,
          detail: null,
          code: null,
          installerFile: file,
          available: version,
        });
        return state;
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const { code, friendly } = netHttp.explainNetworkError(raw);
        set({ status: "error", stage: "download", code, detail: raw, error: friendly, url });
        if (attempt < ATTEMPTS) await wait(attempt * 3000);
      }
    }
    return state;
  } finally {
    fallbackRunning = false;
  }
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
  if (state.status !== "ready") return { ok: false, error: "No update is ready." };
  // Installer fetched by the fallback path: run it directly. NSIS reinstalls
  // in place, so activation, settings and the local database stay put.
  if (state.installerFile && fs.existsSync(state.installerFile)) {
    try {
      spawn(state.installerFile, ["/S"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } catch (err) {
      const raw = String(err?.message || err);
      set({ status: "error", stage: "install", detail: raw, error: "The installer could not be started." });
      return { ok: false, error: "The installer could not be started." };
    }
    setTimeout(() => app.quit(), 1500);
    return { ok: true };
  }
  if (!autoUpdater) return { ok: false, error: "No update is ready." };
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true };
}

/** Address a counter can open in a browser when everything else failed. */
const downloadPage = () => installerUrl(state.available);


function start() {
  if (paused) return;
  void check();
  timer = setInterval(() => void check(), SIX_HOURS);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Safe mode calls this so a broken build cannot keep reinstalling itself. */
function pause() {
  paused = true;
  stop();
}

/**
 * A launch that reached the till proves the build works, so automatic updates
 * come back on their own — a single bad start can no longer pause them for ever.
 */
function resume() {
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
    try {
      const request = net.request({ url, redirect: "follow" });
      request.on("response", (response) => {
        if (response.statusCode !== 200) {
          response.resume?.();
          resolve(null);
          return;
        }
        let body = "";
        response.on("data", (chunk) => {
          body += chunk.toString("utf8");
        });
        response.on("end", () => resolve(body));
        response.on("error", () => resolve(null));
      });
      request.on("error", () => resolve(null));
      request.end();
    } catch {
      resolve(null);
    }
  });
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
          `$s = Get-AuthenticodeSignature -LiteralPath ${JSON.stringify(file)}; ` +
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
 * Nothing downloaded from the feed is executed until it proves it came from
 * us. A published sha512 is the strongest proof; a valid Authenticode
 * signature (matching POS_UPDATE_PUBLISHER when that is configured) is the
 * fallback. If neither can be established the file is deleted, not run —
 * transport security alone is not enough to justify running an installer
 * silently as the logged-in operator.
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
    return { ok: true, proof: "checksum" };
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
  const publisher = (process.env.POS_UPDATE_PUBLISHER || "").trim();
  if (publisher && !signature.subject.toLowerCase().includes(publisher.toLowerCase()))
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
  if (!version) return { ok: false, error: "No earlier version has been recorded yet." };
  if (process.platform !== "win32")
    return { ok: false, error: "Roll back is only supported on Windows." };
  const url = rollbackUrl(version);
  if (!url) return { ok: false, error: "No update feed is configured for this build." };
  if (!/^https:\/\//i.test(url))
    return { ok: false, error: "The update feed is not served over a secure connection." };
  const file = path.join(os.tmpdir(), `pos-rollback-${version}.exe`);
  try {
    await download(url, file, onProgress);
  } catch (err) {
    return { ok: false, error: `Could not download version ${version}: ${err?.message || err}` };
  }
  const verified = await verifyInstaller(file, version);
  if (!verified.ok) {
    fs.rm(file, { force: true }, () => {});
    return { ok: false, error: verified.error };
  }
  try {
    spawn(file, ["/S"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch (err) {
    return { ok: false, error: `Could not start the installer: ${err?.message || err}` };
  }
  setTimeout(() => app.quit(), 1500);
  return { ok: true, version, verifiedBy: verified.proof };
}


module.exports = {
  start,
  stop,
  pause,
  resume,
  isPaused,
  check,
  downloadUpdate,
  downloadAndInstall,
  install,
  rollback,
  diagnose,
  downloadPage,
  status: () => state,
};
