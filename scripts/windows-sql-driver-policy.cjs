/** Keep the selected SQL driver pinned and identical in source and package. */
function sqlDriverFailures(manifest, lock, installedVersion) {
  const failures = [];
  const selected = manifest.dependencies?.mssql;
  if (typeof selected !== "string" || !/^\d+\.\d+\.\d+$/.test(selected)) {
    failures.push("mssql must be pinned to an exact version");
    return failures;
  }
  if (lock.packages?.[""]?.dependencies?.mssql !== selected ||
      lock.packages?.["node_modules/mssql"]?.version !== selected) {
    failures.push(`mssql lockfile must match the selected version ${selected}`);
  }
  if (installedVersion !== selected) {
    failures.push(`installed mssql must match the selected version ${selected}`);
  }
  return failures;
}

function packagedSqlDriverFailures(asar, archive, selectedVersion) {
  // ASAR traverses directories using path.sep. A slash-separated literal is
  // treated as one directory name on Windows even when the entry exists.
  const path = require("node:path");
  const filename = path.join("node_modules", "mssql", "package.json");
  const driver = JSON.parse(asar.extractFile(archive, filename).toString("utf8"));
  return driver.version === selectedVersion ? [] : [
    "packaged SQL Server driver version differs from the selected version",
  ];
}

module.exports = { sqlDriverFailures, packagedSqlDriverFailures };
