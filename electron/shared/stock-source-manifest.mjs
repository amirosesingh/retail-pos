/** Immutable source claims only: this module grants no permission, stock effect,
 * document acceptance, clock verification or historical coverage. */
export const STOCK_SOURCE_ACTIONS = Object.freeze({
  RECEIVE: 'receivings',
  ADJUST: 'stock_adjustments',
  PRODUCT_CREATE: 'products',
  PRODUCT_MERGE: 'product_merge',
  TRANSFER_DISPATCH: 'stock_transfers',
  TRANSFER_RECEIVE: 'stock_transfers',
  SPONSORSHIP_ISSUE: 'sponsorships',
  MISSED_BILL: 'missed_bill',
});

const FIELDS = ['version', 'operationId', 'action', 'document', 'authorId', 'terminalId',
  'branchId', 'productId', 'delta', 'effectiveAt', 'recordedAt', 'sourceRefs'];
const SOURCES = new Set(['item_activity_logs', 'stock_adjustments', 'stock_delta_applied']);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const encoder = new TextEncoder();
const fail = (code = 'ESTOCK_SOURCE_INVALID') => {
  throw Object.assign(new Error('The original stock source claim could not be verified.'), { code });
};

function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) fail();
  return value;
}
function identifier(value, requireUuid = false) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 128
    || /[\u0000-\u001f\u007f]/u.test(value) || (requireUuid && !UUID.test(value))) fail();
  // Do not sign strings PostgreSQL cannot represent as valid UTF-8.
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail();
  }
  return UUID.test(value) ? value.toLowerCase() : value;
}
function integer(value) {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,37})$/.test(value)) fail();
  return String(BigInt(value));
}

// Same exact 100ns instant semantics as the existing stock-history contract.
// Canonicalizing a timestamp does not establish that the device clock was true.
function instant(value) {
  if (typeof value !== 'string') fail();
  const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!p || +p[1] < 1 || +p[4] > 23 || +p[5] > 59 || +p[6] > 59) fail();
  const iso = `${p[1]}-${p[2]}-${p[3]}T${p[4]}:${p[5]}:${p[6]}.000Z`, ms = Date.parse(iso);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== iso) fail();
  let offset = 0n;
  if (p[8] !== 'Z') {
    const hours = +p[8].slice(1, 3), minutes = +p[8].slice(4);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) fail();
    offset = BigInt(hours * 60 + minutes) * (p[8][0] === '-' ? -1n : 1n);
  }
  return BigInt(ms) * 10000n - offset * 600000000n + BigInt((p[7] ?? '').padEnd(7, '0'));
}
function canonicalInstant(ticks) {
  let seconds = ticks / 10000000n, fraction = ticks % 10000000n;
  if (fraction < 0n) { seconds--; fraction += 10000000n; }
  const date = new Date(Number(seconds * 1000n));
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) fail();
  const prefix = date.toISOString().slice(0, 19);
  if (prefix.length !== 19) fail();
  return `${prefix}.${String(fraction).padStart(7, '0')}Z`;
}
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** A zero delta can describe source/cohort evidence; it is not admission of a
 * zero-delta movement, which the separate movement validator still rejects. */
export function normalizeStockSourceManifest(input) {
  const value = exact(input, FIELDS);
  if (value.version !== 1 || typeof value.action !== 'string' || !Object.hasOwn(STOCK_SOURCE_ACTIONS, value.action)) fail();
  const document = exact(value.document, ['type', 'id']);
  if (document.type !== STOCK_SOURCE_ACTIONS[value.action]) fail();
  const delta = integer(value.delta), effective = instant(value.effectiveAt), recorded = instant(value.recordedAt);
  if (effective > recorded || !Array.isArray(value.sourceRefs) || value.sourceRefs.length > 2000) fail();
  const seen = new Set(), totals = new Map();
  const sourceRefs = value.sourceRefs.map(ref => {
    if (!Array.isArray(ref) || ref.length !== 3 || !SOURCES.has(ref[0])) fail();
    const type = ref[0], id = identifier(ref[1], true), quantity = integer(ref[2]);
    const key = `${type}:${id}`;
    if (seen.has(key)) fail();
    seen.add(key);
    totals.set(type, (totals.get(type) ?? 0n) + BigInt(quantity));
    return Object.freeze([type, id, quantity]);
  }).sort((left, right) => compare(left[0], right[0]) || compare(left[1], right[1]));
  if ([...totals.values()].some(total => total !== BigInt(delta))) fail();
  const result = Object.freeze({
    version: 1,
    operationId: identifier(value.operationId, true),
    action: value.action,
    document: Object.freeze({ type: document.type, id: identifier(document.id, true) }),
    authorId: identifier(value.authorId, true),
    terminalId: identifier(value.terminalId),
    branchId: identifier(value.branchId),
    productId: identifier(value.productId, true),
    delta,
    effectiveAt: canonicalInstant(effective),
    recordedAt: canonicalInstant(recorded),
    sourceRefs: Object.freeze(sourceRefs),
  });
  if (encoder.encode(JSON.stringify(result)).length > 16384) fail('ESTOCK_SOURCE_OVERSIZED');
  return result;
}

export function stockSourceManifestJson(input) {
  return JSON.stringify(normalizeStockSourceManifest(input));
}
