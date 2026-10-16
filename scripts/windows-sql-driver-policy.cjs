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

module.exports = { sqlDriverFailures };
