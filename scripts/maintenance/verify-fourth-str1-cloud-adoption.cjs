// Read-only exact-artifact verifier. No driver, connection, credentials or execute path.
const fs = require("node:fs"),
  path = require("node:path");
const { sha } = require("../lib/local54-fourth-adoption.cjs");
function loadVerified(root = path.resolve(__dirname, "../..")) {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(root, "scripts/maintenance/fourth-str1-cloud-adoption.manifest.json"),
      "utf8",
    ),
  );
  if (
    manifest.version !== 1 ||
    manifest.preparedOnly !== true ||
    manifest.executionAuthorized !== false ||
    !/^[A-F0-9]{64}$/.test(manifest.privatePackageSha256) ||
    manifest.sqlArtifact !== "scripts/maintenance/adopt-fourth-str1-cloud-closing.sql" ||
    manifest.privatePackage !==
      "maintenance-private.local/local54-fourth/" + manifest.privatePackageSha256 + ".json"
  )
    throw Error("Unexpected exact maintenance manifest");
  const source = fs.readFileSync(path.join(root, manifest.sqlArtifact), "utf8"),
    packageText = fs.readFileSync(path.join(root, manifest.privatePackage), "utf8");
  if (
    sha(source, "utf8") !== manifest.sqlSha256 ||
    sha(packageText, "utf8") !== manifest.privatePackageSha256 ||
    sha(packageText) !== manifest.packageSqlSha256
  )
    throw Error("Missing or changed reviewed artifact/private package");
  const payload = JSON.parse(packageText);
  if (
    payload.branch !== manifest.branch ||
    payload.shift !== manifest.shift ||
    JSON.stringify(payload.identity) !== JSON.stringify(manifest.identity) ||
    !Array.isArray(payload.beforeTables) ||
    typeof payload.sourceGraphText !== "string"
  )
    throw Error("Private before-image/source identity differs");
  return { manifest, source, packageText };
}
if (require.main === module) {
  try {
    if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(["--verify"]))
      throw Error("Only --verify is supported. No execution is authorized or implemented.");
    const { manifest } = loadVerified();
    console.log(
      JSON.stringify({
        verifiedArtifactsOnly: true,
        sqlSha256: manifest.sqlSha256,
        privatePackageSha256: manifest.privatePackageSha256,
        executionAuthorized: false,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { loadVerified };
