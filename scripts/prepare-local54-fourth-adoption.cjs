// PREPARATION ONLY: produce review artifacts; never opens a database connection.
const fs = require("node:fs"),
  path = require("node:path");
const { build, NAMES, rowSignature, sha } = require("./lib/local54-fourth-adoption.cjs");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");
const {
  decimal,
  parseExactJson,
  isExactNumber,
  instant,
} = require("../electron/sync/shift-recovery-exact.cjs");
function fixedDecimal(value) {
  const normalized = decimal(isExactNumber(value) ? value.raw : String(value));
  if (normalized === undefined) throw Error("Unprovable proposed summary");
  if (normalized === "0") return "0.000000000000";
  let [digits, exponent] = normalized.split("e"),
    negative = digits.startsWith("-");
  if (negative) digits = digits.slice(1);
  let point = digits.length + Number(exponent),
    whole = point <= 0 ? "0" : digits.padEnd(point, "0").slice(0, point),
    fraction = point <= 0 ? "0".repeat(-point) + digits : digits.slice(point);
  if (fraction.length > 12) throw Error("Proposed summary exceeds SQL precision");
  return (negative ? "-" : "") + whole + "." + fraction.padEnd(12, "0");
}
function sqlClock(text) {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,7}))?(?:Z|\+00:00)$/.exec(text);
  if (!match) throw Error("Need reviewed UTC SQL clock");
  return match[1] + "." + (match[2] ?? "").padEnd(7, "0") + "Z";
}
function digest(rows) {
  return sha(
    [...rows]
      .sort((a, b) =>
        a.table_name === b.table_name
          ? a.id.localeCompare(b.id)
          : a.table_name.localeCompare(b.table_name),
      )
      .map((r) => r.table_name + ":" + r.id.toLowerCase() + ":" + r.signature)
      .join(String.fromCharCode(30)),
  );
}
function main() {
  if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(["--prepare"]))
    throw Error("Only --prepare is supported; this tool cannot execute SQL.");
  const root = path.resolve(__dirname, "..");
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, ".tmp", name), "utf8"));
  const cloud = read("local54-cloud-private.json"),
    local = read("local54-local-private.json"),
    metadata = read("local54-fourth-full-metadata-private.json"),
    audits = read("local54-cloud-audits-private.json");
  const shift = "f7c9512a-92dc-4f88-b49d-71d55c577670",
    branch = "a611a328-2217-4d77-944a-5f6a637d123b",
    three = [
      "d252a275-ebf7-4a09-8cd7-a45706c594a3",
      "2e735bd8-0db2-44fb-a6f7-e28edc64f7e0",
      "85902cc1-9804-4d6f-af4f-f73a1e7799b8",
    ];
  if (
    cloud.project !== "qhrufhtbeguxydenzfey" ||
    cloud.branch !== branch ||
    local.branch !== branch ||
    metadata.identity.server_name.toUpperCase() !== "LAPTOP-N0QBONGL\\LCRPOS" ||
    metadata.identity.database_name !== "POS_Local" ||
    metadata.identity.database_guid.toUpperCase() !== "CEAFA630-D613-423C-8997-8A31DF70C506" ||
    String(metadata.authorProof?.target_closing_starts) !== "0" ||
    metadata.authorProof.author_attestations_object_id !== null
  )
    throw Error("Fresh exact capture identity/author-proof evidence differs.");
  const registry = loadRegistry(),
    tables = NAMES.map((name) => registry.tables.find((t) => t.cloudTable === name));
  const signatureRows = (set, accept) =>
    tables.flatMap((table) =>
      set
        .find((p) => p.table === table.cloudTable)
        .rows.filter((r) =>
          accept(String(table.cloudTable === "shifts" ? r.id : r.shift_id).toLowerCase()),
        )
        .map((row) => ({
          table_name: table.cloudTable,
          id: row.id.toLowerCase(),
          signature: rowSignature(table, row),
        })),
    );
  const afterThree = structuredClone(local.tables);
  for (const id of three) {
    const parent = afterThree[0].rows.find((r) => r.id.toLowerCase() === id),
      source = parseExactJson(cloud.rows.find((r) => r.id === id).graph_text).find(
        (p) => p.table === "shifts",
      ).rows[0];
    if (String(parent.row_version) !== "5" || decimal(source.row_version) !== "6e0")
      throw Error("Three-shift pre/post clocks changed.");
    const audit = audits.find((a) => a.shift_id === id);
    if (!audit) throw Error("Missing exact three-shift audit");
    const accepted = parseExactJson(audit.after_json);
    for (const field of [
      "expected_cash",
      "expected_card",
      "expected_digital",
      "variance_cash",
      "variance_total",
    ]) {
      if (decimal(source[field]) !== decimal(accepted[field]))
        throw Error("Approved audit/source summary changed");
      parent[field] = fixedDecimal(source[field]);
    }
    if (
      decimal(source.row_version) !== decimal(accepted.row_version) ||
      instant(source.updated_at) !== instant(accepted.updated_at)
    )
      throw Error("Approved audit/source clocks changed");
    parent.row_version = "6";
    parent.updated_at = sqlClock(source.updated_at);
  }
  const beforeTables = local.tables.map((p) => ({
    table: p.table,
    rows: p.rows.filter(
      (row) => String(p.table === "shifts" ? row.id : row.shift_id).toLowerCase() === shift,
    ),
  }));
  const selectedAudits = audits.filter((a) => three.includes(a.shift_id));
  if (selectedAudits.length !== 3) throw Error("Need exact three reviewed cloud audits.");
  const threeReceipt = {
    id: "6bf0deed-ea7a-4a2f-9265-b2e92bbce754",
    before: digest(signatureRows(local.tables, (id) => three.includes(id))),
    after: digest(signatureRows(afterThree, (id) => three.includes(id))),
    source: sha(
      selectedAudits
        .map((a) => a.id)
        .sort()
        .join("|"),
      "utf8",
    ),
  };
  const result = build({
    registry,
    metadata,
    identity: metadata.identity,
    branch,
    shift,
    maintenanceId: "aa833c15-85f3-4dfd-9b9e-cc0a3df278f8",
    sourceGraphText: cloud.rows.find((r) => r.id === shift).graph_text,
    beforeTables,
    otherExpected: signatureRows(afterThree, (id) => id !== shift),
    threeReceipt,
  });
  const directory = path.join(root, "maintenance-private.local", "local54-fourth");
  fs.mkdirSync(directory, { recursive: true });
  const packagePath = path.join(directory, result.fileHash + ".json");
  if (fs.existsSync(packagePath) && fs.readFileSync(packagePath, "utf8") !== result.packageText)
    throw Error("Existing private archive hash collision.");
  fs.writeFileSync(packagePath, result.packageText, { mode: 0o600 });
  const artifact = path.join(root, "scripts", "maintenance", "adopt-fourth-str1-cloud-closing.sql");
  fs.writeFileSync(artifact, result.sql);
  fs.writeFileSync(
    path.join(root, "scripts", "maintenance", "fourth-str1-cloud-adoption.manifest.json"),
    JSON.stringify(
      {
        version: 1,
        preparedOnly: true,
        identity: metadata.identity,
        branch,
        shift,
        sqlArtifact: "scripts/maintenance/adopt-fourth-str1-cloud-closing.sql",
        sqlSha256: sha(result.sql, "utf8"),
        privatePackage: "maintenance-private.local/local54-fourth/" + result.fileHash + ".json",
        privatePackageSha256: result.fileHash,
        packageSqlSha256: result.packageHash,
        executionAuthorized: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      preparedOnly: true,
      sqlArtifact: path.relative(root, artifact),
      sqlSha256: sha(result.sql, "utf8"),
      privatePackage: path.relative(root, packagePath),
      privatePackageSha256: result.fileHash,
      packageSqlSha256: result.packageHash,
      changes: { parentFields: 17, existingChildren: 7, maintenanceReceipts: 1 },
      executionAuthorized: false,
    }),
  );
}
if (require.main === module) main();
module.exports = { fixedDecimal, sqlClock, digest };
