const { test } = require('node:test');
const assert = require('node:assert/strict');

const base = 'https://updatecms.luckycharmsdnbhd.com';
async function serve(path, env, method = 'GET') {
  const { default: worker } = await import('../server/ios-ota/worker.js');
  return worker.fetch(new Request(base + path, { method }), env);
}
const bucket = () => ({ get: async () => ({ body: 'bundle', size: 6, httpEtag: '"test"' }) });
test('only iOS OTA paths are served, leaving APK and EXE routes alone', async () => {
  const response = await serve('/pos-app/beta/latest.json', { OTA_BUCKET: bucket() });
  assert.equal(response.status, 404);
});
test('manifest is uncached and emergency stop prevents reads', async () => {
  const path = '/pos-app/ios-ota/staging/manifest.json';
  const response = await serve(path, { OTA_BUCKET: bucket() });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const stopped = await serve(path, { OTA_STOP: 'true', OTA_BUCKET: { get: () => assert.fail('must not read') } });
  assert.equal(stopped.status, 503);
  assert.equal(stopped.headers.get('cache-control'), 'no-store');
});
test('versioned ZIP has immutable caching and HEAD contains no body', async () => {
  const response = await serve('/pos-app/ios-ota/releases/1.4.75-beta.1/bundle.zip', { OTA_BUCKET: bucket() }, 'HEAD');
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.equal(response.headers.get('content-length'), '6');
  assert.equal(await response.text(), '');
});
test('missing releases are not cached and writes are rejected', async () => {
  const path = '/pos-app/ios-ota/staging/manifest.json';
  const missing = await serve(path, { OTA_BUCKET: { get: async () => null } });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), 'no-store');
  assert.equal((await serve(path, {}, 'POST')).status, 405);
});
