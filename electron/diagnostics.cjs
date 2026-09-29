/**
 * Durable crash evidence.
 *
 * The audit found the till could die with nothing on disk to explain it:
 * native crashes produced no minidump, the local app server's output only ever
 * reached a console nobody sees, and a renderer that vanished was inferred a
 * boot later. Everything here writes to files in the user data folder that the
 * recovery screen's "Open log folder" button already reveals, so a shop can
 * send evidence without a developer on the phone.
 *
 * Nothing in this module may throw: it runs on the crash path.
 */
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const MAX_BYTES = 512 * 1024;

let baseDir = null;
let crashDir = null;

function dir() {
  if (baseDir) return baseDir;
  try {
    const { app } = require("electron");
    baseDir = app.getPath("userData");
  } catch {
    baseDir = os.tmpdir();
  }
  return baseDir;
}

/** Keeps one generation of history; a log that grows forever is its own fault. */
function rotate(file) {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* missing file, or a rename we can live without */
  }
}

/** Append a line. Synchronous on purpose — a crash gives us no second tick. */
function append(name, line) {
  try {
    const file = path.join(dir(), name);
    rotate(file);
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never be the reason the till stops */
  }
}

const logCrash = (event, detail) =>
  append("crash.log", `${event} ${detail ? JSON.stringify(detail) : ""}`.trim());

const logServer = (line) => append("server.log", line);

/** Durable, credential-free evidence for local SQL/cloud routing failures. */
function logConnection(event, detail = {}) {
  const safe = {};
  const allowed = ["state", "connected", "scope", "code", "stage", "category", "message", "latencyMs"];
  for (const key of allowed) {
    const value = detail?.[key];
    if (value == null) continue;
    safe[key] = typeof value === "string"
      ? value
          .replace(/https?:\/\/[^\s]+/gi, "[url]")
          .replace(/(apikey|authorization|token|password|key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
          .slice(0, 600)
      : value;
  }
  append("connection.log", `${String(event ?? "connection").slice(0, 100)} ${JSON.stringify(safe)}`);
}

/**
 * Returns recent database failures without requiring SQL Server to be online.
 * connection.log is the durable source so connection failures remain visible
 * even when the database that normally stores jobs cannot be opened.
 */
function databaseErrors(limit = 100) {
  const rows = [];
  for (const line of tail("connection.log", Math.max(100, Math.min(Number(limit) * 8, 1600))).reverse()) {
    const match = String(line).match(/^(\S+)\s+(\S+)\s+(\{.*\})$/);
    if (!match) continue;
    let detail;
    try { detail = JSON.parse(match[3]); } catch { continue; }
    const event = match[2];
    const text = `${event} ${detail?.state ?? ""} ${detail?.code ?? ""} ${detail?.message ?? ""}`;
    const isFailure = detail?.connected === false || Boolean(detail?.code) || Boolean(detail?.message) || /(?:error|failed|failure|timeout|migration_required)/i.test(text);
    if (!isFailure || /(?:validating|connecting|disconnect(?:ed)?|disabled)$/i.test(String(detail?.state ?? ""))) continue;
    rows.push({
      id: `${match[1]}:${event}:${rows.length}`,
      occurred_at: match[1],
      event,
      category: detail?.category ?? (/sync/i.test(text) ? "synchronization" : /migrat/i.test(text) ? "migration" : /validat|schema/i.test(text) ? "validation" : "connection"),
      stage: detail?.stage ?? null,
      state: detail?.state ?? null,
      code: detail?.code ?? null,
      message: detail?.message ?? "The database operation did not complete.",
    });
    if (rows.length >= Math.max(1, Math.min(Number(limit) || 100, 500))) break;
  }
  return rows;
}

/**
 * Native minidumps.
 *
 * A segfault in the GPU or a native module never reaches JavaScript, so
 * without this the process simply disappears. Uploads stay off: the dumps are
 * for the local folder only, never sent anywhere.
 */
function startCrashReporter() {
  try {
    const { crashReporter } = require("electron");
    crashReporter.start({
      productName: "POS",
      companyName: "POS",
      submitURL: "",
      uploadToServer: false,
      compress: true,
    });
    try {
      const { app } = require("electron");
      crashDir = app.getPath("crashDumps");
    } catch {
      crashDir = null;
    }
    return true;
  } catch (error) {
    logCrash("crash-reporter.unavailable", { error: error?.message ?? String(error) });
    return false;
  }
}

/** Records a renderer or utility process dying, at the moment it happens. */
function watchWindow(win, label) {
  try {
    win.webContents.on("render-process-gone", (_event, details) => {
      logCrash("render-process-gone", {
        window: label,
        reason: details?.reason,
        exitCode: details?.exitCode,
      });
    });
    win.webContents.on("unresponsive", () => logCrash("window.unresponsive", { window: label }));
    win.webContents.on("responsive", () => logCrash("window.responsive", { window: label }));
  } catch {
    /* a window we cannot instrument is still a window that works */
  }
}

function watchApp(app) {
  try {
    app.on("child-process-gone", (_event, details) => {
      logCrash("child-process-gone", {
        type: details?.type,
        reason: details?.reason,
        exitCode: details?.exitCode,
      });
    });
  } catch {
    /* older Electron without the event */
  }
}

const listOf = (folder) => {
  try {
    return fs.readdirSync(folder);
  } catch {
    return [];
  }
};

const tail = (name, lines) => {
  try {
    const text = fs.readFileSync(path.join(dir(), name), "utf8").trimEnd().split("\n");
    return text.slice(-lines);
  } catch {
    return [];
  }
};

/**
 * One text file a shop can email in.
 *
 * Deliberately no credentials: connection logs already redact them, and this
 * only ever copies existing log tails plus machine facts.
 */
function writeReport(extra = {}) {
  const report = [
    "POS diagnostic report",
    `generated: ${new Date().toISOString()}`,
    `platform:  ${process.platform} ${process.arch} (${os.release()})`,
    `electron:  ${process.versions.electron ?? "n/a"}  node: ${process.versions.node}`,
    `app data:  ${dir()}`,
    `minidumps: ${crashDir ? `${crashDir} (${listOf(crashDir).length} file(s))` : "not enabled"}`,
    "",
    ...Object.entries(extra).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    "",
    "--- crash.log (last 80) ---",
    ...tail("crash.log", 80),
    "",
    "--- connection.log (last 200) ---",
    ...tail("connection.log", 200),
    "",
    "--- server.log (last 80) ---",
    ...tail("server.log", 80),
    "",
  ].join("\n");
  const file = path.join(dir(), "diagnostic-report.txt");
  try {
    fs.writeFileSync(file, report);
    return { ok: true, file };
  } catch (error) {
    return { ok: false, file, error: error?.message ?? String(error) };
  }
}

module.exports = {
  logCrash,
  logServer,
  logConnection,
  databaseErrors,
  startCrashReporter,
  watchWindow,
  watchApp,
  writeReport,
  logDirectory: dir,
};
