import { normalizeStockSourceManifest } from './stock-source-manifest.mjs';

// Representation and Merkle membership only. Neither a root nor this verifier
// proves an author, a document/effect, physical time or historical completeness.
const MAX_MEMBERS = 2000, MAX_BYTES = 8 * 1024 * 1024, HASH_WORKERS = 8;
const encoder = new TextEncoder(), HEX = /^[0-9a-f]{64}$/;
const BINDING = ['operationId', 'action', 'authorId', 'terminalId', 'branchId'];
const MEMBER_FIELDS = ['version', 'index', 'count', 'root', 'manifestJson', 'siblings'];
function fail(code = 'ESTOCK_SOURCE_COHORT_INVALID') {
  throw Object.assign(new Error('The original stock-source cohort could not be verified.'), { code });
}
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !fields.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}
function denseArray(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) fail();
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}
// Reject prototype/accessor/hidden-field tricks before canonicalizing source
// data. The concrete source schema still belongs to its existing normalizer.
function plainData(value, depth = 0) {
  if (value === null || typeof value !== 'object') return;
  if (depth > 8) fail();
  if (Array.isArray(value)) denseArray(value, MAX_MEMBERS);
  else exact(value, Object.keys(value));
  for (const key of Object.keys(value)) plainData(value[key], depth + 1);
}
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
function bytes(value) {
  if (typeof value !== 'string' || !HEX.test(value)) fail();
  return Uint8Array.from(value.match(/../g), part => parseInt(part, 16));
}
async function digest(value) {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', value));
}
async function leaf(index, manifestJson) {
  const body = encoder.encode(JSON.stringify(['retail-pos.stock-source-leaf.v1', index, manifestJson]));
  const input = new Uint8Array(body.length + 1); input.set(body, 1);
  return digest(input); // 0x00 domain prefix
}
async function node(left, right) {
  const input = new Uint8Array(65); input[0] = 1; input.set(left, 1); input.set(right, 33);
  return digest(input);
}
async function boundedMap(values, work) {
  const output = new Array(values.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(HASH_WORKERS, values.length) }, async () => {
    for (;;) {
      const index = next++; if (index >= values.length) return;
      output[index] = await work(values[index], index);
    }
  }));
  return output;
}
const depthFor = count => Math.ceil(Math.log2(count));

/** Build only from original source claims. The caller must later sign both
 * count AND root: duplicate-last trees do not uniquely commit their leaf count. */
export async function buildStockSourceCohort(input) {
  const values = denseArray(input, MAX_MEMBERS); if (!values.length) fail();
  let totalBytes = 0;
  const sources = values.map(value => {
    plainData(value);
    const manifest = normalizeStockSourceManifest(value), manifestJson = JSON.stringify(manifest);
    totalBytes += encoder.encode(manifestJson).length;
    if (totalBytes > MAX_BYTES) fail('ESTOCK_SOURCE_COHORT_OVERSIZED');
    return { manifest, manifestJson };
  }).sort((left, right) => left.manifest.productId < right.manifest.productId ? -1 : left.manifest.productId > right.manifest.productId ? 1 : 0);
  const first = sources[0].manifest;
  for (let index = 0; index < sources.length; index++) {
    const current = sources[index].manifest;
    if (BINDING.some(key => current[key] !== first[key]) || (index && sources[index - 1].manifest.productId === current.productId)) fail();
  }
  const levels = [await boundedMap(sources, (source, index) => leaf(index, source.manifestJson))];
  while (levels.at(-1).length > 1) {
    const current = levels.at(-1), pairs = Array.from({ length: Math.ceil(current.length / 2) }, (_, index) => index * 2);
    levels.push(await boundedMap(pairs, index => node(current[index], current[index + 1] ?? current[index])));
  }
  const hashes = levels.map(level => level.map(hex)), root = hashes.at(-1)[0], count = sources.length;
  const members = sources.map((source, index) => {
    const siblings = []; let position = index;
    for (const level of hashes.slice(0, -1)) {
      siblings.push(level[position ^ 1] ?? level[position]); position = Math.floor(position / 2);
    }
    return Object.freeze({ version: 1, index, count, root, manifestJson: source.manifestJson, siblings: Object.freeze(siblings) });
  });
  return Object.freeze({ version: 1, ...Object.fromEntries(BINDING.map(key => [key, first[key]])), count, root, members: Object.freeze(members) });
}

/** expected MUST come from the separately verified signed cohort, never from
 * member itself. This function cannot authenticate that external binding. */
export async function verifyStockSourceMembership(input, expectedInput) {
  const supplied = exact(input, MEMBER_FIELDS), suppliedExpected = exact(expectedInput, ['count', 'root']);
  // Capture plain immutable values before any hash awaits. A caller changing a
  // member/expected object in flight must never replace the verified root.
  const value = Object.freeze({ ...supplied, siblings: Object.freeze([...denseArray(supplied.siblings, 11)]) });
  const expected = Object.freeze({ count: suppliedExpected.count, root: suppliedExpected.root });
  if (value.version !== 1 || !Number.isSafeInteger(value.count) || value.count < 1 || value.count > MAX_MEMBERS
    || !Number.isSafeInteger(value.index) || value.index < 0 || value.index >= value.count
    || !Number.isSafeInteger(expected.count) || expected.count !== value.count || expected.root !== value.root) fail();
  bytes(value.root);
  const siblings = value.siblings;
  if (siblings.length !== depthFor(value.count) || typeof value.manifestJson !== 'string'
    || encoder.encode(value.manifestJson).length > 16384) fail();
  let parsed;
  try { parsed = JSON.parse(value.manifestJson); } catch { fail(); }
  const manifest = normalizeStockSourceManifest(parsed);
  if (JSON.stringify(manifest) !== value.manifestJson) fail();
  let current = await leaf(value.index, value.manifestJson), position = value.index, width = value.count;
  for (const siblingHex of siblings) {
    const sibling = bytes(siblingHex);
    if (position % 2 === 0 && position + 1 >= width && hex(current) !== siblingHex) fail();
    current = position % 2 ? await node(sibling, current) : await node(current, sibling);
    position = Math.floor(position / 2); width = Math.ceil(width / 2);
  }
  if (hex(current) !== value.root) fail();
  return manifest;
}
