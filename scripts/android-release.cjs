#!/usr/bin/env node
/** Configure the generated Capacitor Android app for a signed upgrade build. */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const gradlePath = path.join(root, "android", "app", "build.gradle");
const required = [
  "ANDROID_KEYSTORE_FILE",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD",
  "ANDROID_VERSION_CODE",
  "ANDROID_VERSION_NAME",
];

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const missing = required.filter((name) => !process.env[name]);
if (missing.length) fail(`Missing Android release settings: ${missing.join(", ")}`);
if (!fs.existsSync(gradlePath)) fail("Android app/build.gradle is missing. Run cap sync first.");

const keystorePath = process.env.ANDROID_KEYSTORE_FILE;
if (!fs.existsSync(keystorePath)) fail(`Keystore not found at ${keystorePath}.`);
if (fs.statSync(keystorePath).size === 0) fail(`Keystore at ${keystorePath} is empty.`);

const versionCode = Number.parseInt(process.env.ANDROID_VERSION_CODE, 10);
if (!Number.isSafeInteger(versionCode) || versionCode < 1) {
  fail("ANDROID_VERSION_CODE must be a positive integer.");
}
const versionName = require("./release-version.cjs").displayVersion(process.env.ANDROID_VERSION_NAME || "");

/**
 * Find a `name { ... }` block whose opening brace lives at depth `depth`
 * relative to `from`, ignoring braces inside strings and comments.
 * Returns { start, open, bodyStart, end } where `end` is the index of the
 * closing brace, or null when not found.
 */
function findBlock(source, name, from, to) {
  let depth = 0;
  let i = from;
  let candidate = -1;
  while (i < to) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? to : nl;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close === -1 ? to : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < to) {
        if (source[i] === "\\") i += 2;
        else if (source[i] === quote) { i += 1; break; }
        else i += 1;
      }
      continue;
    }
    if (ch === "{") {
      if (depth === 0 && candidate !== -1) {
        const end = matchBrace(source, i, to);
        if (end === -1) return null;
        return { start: candidate, open: i, bodyStart: i + 1, end };
      }
      depth += 1;
      candidate = -1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      candidate = -1;
      i += 1;
      continue;
    }
    if (depth === 0 && /[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < to && /[A-Za-z0-9_.]/.test(source[j])) j += 1;
      const word = source.slice(i, j);
      candidate = word === name ? i : -1;
      i = j;
      continue;
    }
    if (depth === 0 && !/\s/.test(ch)) candidate = -1;
    i += 1;
  }
  return null;
}

function matchBrace(source, openIndex, to) {
  let depth = 0;
  let i = openIndex;
  while (i < to) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? to : nl;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close === -1 ? to : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < to) {
        if (source[i] === "\\") i += 2;
        else if (source[i] === quote) { i += 1; break; }
        else i += 1;
      }
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

let gradle = fs.readFileSync(gradlePath, "utf8");

const android = findBlock(gradle, "android", 0, gradle.length);
if (!android) fail("Could not locate the android { } block in app/build.gradle.");

// --- versionCode / versionName inside defaultConfig -------------------------
const defaultConfig = findBlock(gradle, "defaultConfig", android.bodyStart, android.end);
if (!defaultConfig) fail("Could not locate defaultConfig { } inside android { }.");
{
  const body = gradle.slice(defaultConfig.bodyStart, defaultConfig.end);
  let patched = body;
  patched = /versionCode\s+\d+/.test(patched)
    ? patched.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    : `\n        versionCode ${versionCode}${patched}`;
  patched = /versionName\s+["'][^"']*["']/.test(patched)
    ? patched.replace(/versionName\s+["'][^"']*["']/, `versionName "${versionName}"`)
    : `\n        versionName "${versionName}"${patched}`;
  gradle = gradle.slice(0, defaultConfig.bodyStart) + patched + gradle.slice(defaultConfig.end);
}

// --- signingConfigs { release { ... } } as a direct child of android { } ----
const androidAfterVersions = findBlock(gradle, "android", 0, gradle.length);
let signingConfigs = findBlock(gradle, "signingConfigs", androidAfterVersions.bodyStart, androidAfterVersions.end);
if (!signingConfigs) {
  const block = `
    signingConfigs {
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_FILE"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
`;
  const buildTypes = findBlock(gradle, "buildTypes", androidAfterVersions.bodyStart, androidAfterVersions.end);
  const insertAt = buildTypes ? buildTypes.start : androidAfterVersions.bodyStart;
  gradle = `${gradle.slice(0, insertAt)}${block.trimStart()}\n    ${gradle.slice(insertAt)}`;
}

// --- signingConfig reference inside buildTypes.release ----------------------
{
  const androidBlock = findBlock(gradle, "android", 0, gradle.length);
  let buildTypes = findBlock(gradle, "buildTypes", androidBlock.bodyStart, androidBlock.end);
  if (!buildTypes) {
    const insertAt = androidBlock.end;
    const block = `
    buildTypes {
        release {
        }
    }
`;
    gradle = gradle.slice(0, insertAt) + block + gradle.slice(insertAt);
    const refreshed = findBlock(gradle, "android", 0, gradle.length);
    buildTypes = findBlock(gradle, "buildTypes", refreshed.bodyStart, refreshed.end);
  }
  let release = findBlock(gradle, "release", buildTypes.bodyStart, buildTypes.end);
  if (!release) {
    gradle = `${gradle.slice(0, buildTypes.bodyStart)}\n        release {\n        }${gradle.slice(buildTypes.bodyStart)}`;
    const refreshed = findBlock(gradle, "android", 0, gradle.length);
    const bt = findBlock(gradle, "buildTypes", refreshed.bodyStart, refreshed.end);
    release = findBlock(gradle, "release", bt.bodyStart, bt.end);
  }
  const body = gradle.slice(release.bodyStart, release.end);
  if (!body.includes("signingConfig signingConfigs.release")) {
    gradle = `${gradle.slice(0, release.bodyStart)}\n            signingConfig signingConfigs.release${body}${gradle.slice(release.end)}`;
  }
}

// --- self-verification ------------------------------------------------------
const definitionCount = (gradle.match(/storeFile\s+file\(System\.getenv\("ANDROID_KEYSTORE_FILE"\)\)/g) || []).length;
if (definitionCount !== 1) {
  fail(`Expected exactly one signingConfigs.release definition, found ${definitionCount}.`);
}
const referenceCount = (gradle.match(/signingConfig\s+signingConfigs\.release/g) || []).length;
if (referenceCount !== 1) {
  fail(`Expected exactly one "signingConfig signingConfigs.release" reference, found ${referenceCount}.`);
}
{
  const androidBlock = findBlock(gradle, "android", 0, gradle.length);
  const buildTypes = findBlock(gradle, "buildTypes", androidBlock.bodyStart, androidBlock.end);
  if (!buildTypes) fail("Verification failed: buildTypes { } is missing.");
  const release = findBlock(gradle, "release", buildTypes.bodyStart, buildTypes.end);
  if (!release) fail("Verification failed: buildTypes.release { } is missing.");
  const refIndex = gradle.search(/signingConfig\s+signingConfigs\.release/);
  if (refIndex < release.bodyStart || refIndex > release.end) {
    fail("Verification failed: signingConfig reference is not inside buildTypes.release.");
  }
  const signing = findBlock(gradle, "signingConfigs", androidBlock.bodyStart, androidBlock.end);
  if (!signing) fail("Verification failed: signingConfigs { } is missing.");
  if (refIndex > signing.start && refIndex < signing.end) {
    fail("Verification failed: signingConfig reference landed inside signingConfigs.");
  }
  fs.writeFileSync(gradlePath, gradle, "utf8");
  console.log("--- android { } after patching ---");
  console.log(gradle.slice(androidBlock.start, findBlock(gradle, "android", 0, gradle.length).end + 1));
  console.log("----------------------------------");
}

console.log(`✓ Android release configured as ${versionName} (${versionCode})`);
