#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(manifest.dependencies?.mssql === "12.7.2", "mssql must remain pinned to 12.7.2");
check(manifest.optionalDependencies?.msnodesqlv8 === "5.5.0", "msnodesqlv8 must remain an optional Windows-only dependency pinned to 5.5.0");
check(manifest.devDependencies?.["@electron/rebuild"] === "4.2.0", "@electron/rebuild must remain pinned to 4.2.0");
check((manifest.build?.asarUnpack ?? []).some((entry) => String(entry).includes("msnodesqlv8")), "msnodesqlv8 must be unpacked from the Electron ASAR");
check((manifest.build?.files ?? []).some((entry) => String(entry).replaceAll("\\", "/").startsWith("database/sqlserver/")), "the SQL Server schema registry and migrations must be included in the Windows package");
check(manifest.build?.npmRebuild === false, "Electron packaging must use the vendor's N-API prebuild instead of rebuilding in the space-containing workspace path");

const sourceBinding = path.join(root, "node_modules", "msnodesqlv8", "prebuilds", "win32-x64", "msnodesqlv8.node");
check(fs.existsSync(sourceBinding), "the win32-x64 msnodesqlv8 native binding is missing; run npm ci and npm run native:rebuild");
try { require("msnodesqlv8"); }
catch (error) { failures.push(`the native SQL Server driver cannot load: ${error.message}`); }

for (const sqlitePackage of ["better-sqlite3", "sqlite3"]) {
  try { require.resolve(sqlitePackage, { paths: [root] }); failures.push(`${sqlitePackage} is installed but SQLite is prohibited`); }
  catch (error) { if (error?.code !== "MODULE_NOT_FOUND") throw error; }
}

const packageDirectory = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (packageDirectory) {
  check(fs.existsSync(packageDirectory), `package directory does not exist: ${packageDirectory}`);
  const executable = path.join(packageDirectory, `${manifest.build?.productName ?? "Retail"}.exe`);
  const unpackedBinding = path.join(packageDirectory, "resources", "app.asar.unpacked", "node_modules", "msnodesqlv8", "prebuilds", "win32-x64", "msnodesqlv8.node");
  check(fs.existsSync(executable), `packaged executable is missing: ${executable}`);
  check(fs.existsSync(unpackedBinding), `packaged native binding is missing: ${unpackedBinding}`);
  // File existence alone misses a corrupt ASAR (for example, source files
  // changing while the archive offsets are being calculated).
  try {
    const asar = require("@electron/asar");
    const { createHash } = require("node:crypto");
    const archive = path.join(packageDirectory, "resources", "app.asar");
    for (const entry of asar.listPackage(archive)) {
      const name = entry.replace(/^[\\/]+/, "");
      const stat = asar.statFile(archive, name);
      if (stat.files || stat.link || stat.unpacked) continue;
      const bytes = asar.extractFile(archive, name);
      check(bytes.length === stat.size, `ASAR size mismatch: ${name}`);
      check(stat.integrity?.algorithm === "SHA256" &&
        createHash("sha256").update(bytes).digest("hex") === stat.integrity.hash,
      `ASAR integrity mismatch: ${name}`);
    }
    const packagedManifest = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
    check(packagedManifest.version === manifest.version, "packaged version differs from the source manifest");
    check(packagedManifest.main === manifest.main, "packaged application entry point differs from the source manifest");
  } catch (error) {
    failures.push(`cannot validate packaged ASAR: ${error.message}`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`Windows package smoke failed: ${failure}`);
  process.exit(1);
}
console.log(packageDirectory
  ? `Windows package smoke passed: ${packageDirectory}`
  : "Windows package source preflight passed; pass the unpacked package directory to validate a built artifact.");
