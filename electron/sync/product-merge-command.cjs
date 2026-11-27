const { recordId } = require("./uuid-fields.cjs");
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const integer = value => typeof value === "string" && /^-?(0|[1-9][0-9]{0,9})$/.test(value) &&
  String(Number(value)) === value && Number(value) >= -2147483648 && Number(value) <= 2147483647;
const revision = value => integer(value) && Number(value) > 0;
const nullableText = value => value === null || typeof value === "string";
const textList = value => Array.isArray(value) && value.length <= 2000 && value.every(code => typeof code === "string" && code.length <= 2000);
const nullableTextList = value => value === null || textList(value);
const hasControlCharacter = value => [...value].some(character => {
  const code = character.codePointAt(0);
  return code < 32 || code === 127;
});
const heldReasons = new Set(["PRODUCT_DELETE_UNVERIFIED", "PRODUCT_HAS_SALES_HISTORY", "PRODUCT_HAS_PURCHASES",
  "PRODUCT_HAS_TRANSFERS", "PRODUCT_HAS_ADJUSTMENTS", "PRODUCT_HAS_PROMOTIONS", "PRODUCT_HAS_ACTIVITY_HISTORY",
  "PRODUCT_HAS_STRUCTURED_BARCODES", "PRODUCT_STOCK_UNVERIFIED", "PRODUCT_OTHER_BRANCH_STOCK", "PRODUCT_OPEN_BOOKING",
  "PRODUCT_HELD_TICKET", "PRODUCT_ALIAS_IN_USE", "PRODUCT_LINKED_RECORD"]);
const fields = (value, names) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const fail = (code = "ESYNC_PRODUCT_MERGE_UNVERIFIED") => Object.assign(
  new Error("This merge is waiting for verified inventory synchronization. No local stock was changed."), { code });

function request(input, branch) {
  if (!fields(input, ["version", "operationId", "branchId", "masterId", "roster"]) || input.version !== 1 ||
      input.branchId !== branch || typeof branch !== "string" || !branch || branch !== branch.trim() || branch.length > 128 ||
      hasControlCharacter(branch) ||
      !uuid(input.operationId) || !uuid(input.masterId) || !Array.isArray(input.roster) ||
      input.roster.length < 2 || input.roster.length > 50) throw fail("ESYNC_PRODUCT_MERGE_INVALID");
  const wanted = new Set();
  const roster = input.roster.map(row => {
    if (!fields(row, ["id", "sku", "rowVersion"]) || !uuid(row.id) || wanted.has(row.id) ||
        !nullableText(row.sku) || (row.sku !== null && row.sku.length > 128) || !revision(row.rowVersion))
      throw fail("ESYNC_PRODUCT_MERGE_INVALID");
    wanted.add(row.id);
    return { id: row.id, sku: row.sku, rowVersion: row.rowVersion };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (!wanted.has(input.masterId)) throw fail("ESYNC_PRODUCT_MERGE_INVALID");
  return { version: 1, operationId: input.operationId, branchId: branch, masterId: input.masterId, roster };
}

function acceptance(input, result) {
  if (!fields(result, ["ok", "operationId", "branchId", "master", "removed", "held"]) || result.ok !== true ||
      result.operationId !== input.operationId || result.branchId !== input.branchId || !Array.isArray(result.removed) ||
      !Array.isArray(result.held) || result.removed.length + result.held.length !== input.roster.length - 1 ||
      !fields(result.master, ["id", "sku", "quantity", "stockTotal", "rowVersion", "aliases"]) ||
      result.master.id !== input.masterId || !integer(result.master.quantity) || !integer(result.master.stockTotal) ||
      !revision(result.master.rowVersion) || !nullableTextList(result.master.aliases)) throw fail();
  const expectedMaster = input.roster.find(row => row.id === input.masterId);
  if (result.master.sku !== expectedMaster.sku || Number(result.master.rowVersion) !== Number(expectedMaster.rowVersion) + Number(result.removed.length > 0))
    throw fail();
  const expected = new Map(input.roster.filter(row => row.id !== input.masterId).map(row => [row.id, row]));
  for (const row of result.removed) {
    if (!fields(row, ["id", "sku", "name", "quantity", "barcode", "aliases"]) || !expected.has(row.id) ||
        row.sku !== expected.get(row.id).sku || typeof row.name !== "string" || row.name.length > 1000 || !integer(row.quantity) ||
        !nullableText(row.barcode) || (row.barcode !== null && row.barcode.length > 2000) || !nullableTextList(row.aliases)) throw fail();
    expected.delete(row.id);
  }
  for (const row of result.held) {
    if (!fields(row, ["id", "name", "code"]) || !expected.has(row.id) || typeof row.name !== "string" || row.name.length > 1000 ||
        !heldReasons.has(row.code)) throw fail();
    expected.delete(row.id);
  }
  return result;
}

function receivedReceipt(input, response) {
  if (!fields(response, ["ok", "receipt"]) || response.ok !== true) throw fail();
  return response.receipt === null ? null : acceptance(input, response.receipt);
}

function decodeProducts(rows, input) {
  if (rows.length !== input.roster.length) throw fail("ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT");
  const products = new Map();
  for (const row of rows) {
    const id = recordId(row.id), expected = input.roster.find(item => item.id === id);
    let stock, aliases;
    try { stock = JSON.parse(row.stock); aliases = JSON.parse(row.aliases ?? "[]"); }
    catch { throw fail("ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT"); }
    if (!expected || products.has(id) || expected.sku !== row.sku || expected.rowVersion !== String(row.row_version) ||
        row.owner_store_id !== input.branchId || row.deleted_at !== null || typeof row.name !== "string" ||
        !stock || Array.isArray(stock) || typeof stock !== "object" || !textList(aliases) ||
        !Object.values(stock).every(qty => Number.isInteger(qty) && integer(String(qty))) ||
        Object.values(stock).reduce((count, qty) => count + qty, 0) !== row.stock_quantity)
      throw fail("ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT");
    products.set(id, { ...row, stock, aliases });
  }
  return products;
}

function mergePlan(input, result, products) {
  const winner = products.get(input.masterId);
  const site = input.branchId;
  const quantityAtSite = product => Object.hasOwn(product.stock, site) ? product.stock[site] : 0;
  let transferred = 0;
  const aliases = new Set(winner.aliases);
  for (const row of result.removed) {
    const product = products.get(row.id);
    if (product.blocked || product.name !== row.name || product.barcode !== row.barcode ||
        JSON.stringify(product.aliases) !== JSON.stringify(row.aliases ?? []) ||
        Object.entries(product.stock).some(([branch, amount]) => branch !== site && amount !== 0) ||
        String(quantityAtSite(product)) !== row.quantity) throw fail("ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT");
    transferred += Number(row.quantity);
    for (const alias of [product.barcode, product.sku, ...product.aliases]) {
      if (typeof alias === "string" && alias.trim() && alias !== winner.barcode && alias !== winner.sku) aliases.add(alias);
    }
  }
  // Every existing master alias is retained (including original spelling).
  // SQL Server stores the hosted null alias array as an empty array.
  const masterAliases = result.master.aliases ?? [];
  if (result.held.some(row => products.get(row.id).name !== row.name) ||
      String(quantityAtSite(winner) + transferred) !== result.master.quantity ||
      String(winner.stock_quantity + transferred) !== result.master.stockTotal ||
      (result.removed.length ? masterAliases.length !== aliases.size || !masterAliases.every(alias => aliases.delete(alias)) :
        JSON.stringify(masterAliases) !== JSON.stringify(winner.aliases))) throw fail("ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT");
  return { stock: transferred === 0 ? winner.stock : { ...winner.stock, [site]: Number(result.master.quantity) },
    aliases: masterAliases, total: Number(result.master.stockTotal), revision: Number(result.master.rowVersion),
    removed: result.removed.map(row => row.id) };
}

module.exports = { request, acceptance, receivedReceipt, decodeProducts, mergePlan, fail };
