const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { betaVersion, prepareBeta, BETA_BASE } = require('./prepare-beta.cjs');
const { publishBeta, assertBetaKey } = require('./publish-beta-release.cjs');
const { validateRelease } = require('./publish-windows-release.cjs');

test('beta identities are separate and never rewrite backend configuration', () => {
  assert.equal(betaVersion('1.4.74', 12), '1.4.75-beta.12');
  assert.throws(() => betaVersion('1.4.75-beta.1', 2));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-beta-test-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.4.74', build: { win: {}, extraMetadata: { backend: 'unchanged' } } }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.4.74', packages: { '': { version: '1.4.74' } } }));
    prepareBeta(root, '1.4.75-beta.1');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    assert.equal(pkg.build.appId, 'app.lovable.pos.beta');
    assert.equal(pkg.name, 'retail-pos-beta');
    assert.equal(pkg.build.productName, 'Retail Beta');
    assert.equal(pkg.build.publish[0].url, `${BETA_BASE}/latest/`);
    assert.equal(pkg.build.extraMetadata.backend, 'unchanged');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'))).packages[''].version, pkg.version);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-beta-pair-'));
  const windows = path.join(root, 'windows'), android = path.join(root, 'android');
  fs.mkdirSync(windows); fs.mkdirSync(android);
  const version = '1.4.75-beta.1', commit = 'a'.repeat(40), id = `beta-v${version}-aaaaaaa`;
  const exe = `Retail Setup ${version}.exe`, apk = `Retail-${version}.apk`, bytes = Buffer.from('installer');
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  const write = (dir, name, data) => fs.writeFileSync(path.join(dir, name), typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data);
  write(windows, exe, bytes); write(windows, exe + '.blockmap', 'blocks');
  write(windows, 'latest.yml', yaml.dump({ version, path: exe, sha512, files: [{ url: exe, sha512, size: bytes.length }] }));
  write(windows, 'release.json', { version, commit, tag: `beta-v${version}`, path: `pos-app/beta/releases/${id}/` });
  write(android, apk, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]));
  write(android, 'latest.json', { version, commit, tag: `beta-v${version}`, path: `pos-app/beta/releases/${id}/android/`, file: apk });
  const manifest = { version, buildNumber: 1, bundleEpoch: 1, apkUrl: `${BETA_BASE}/releases/${id}/android/${apk}`, windowsUrl: `${BETA_BASE}/latest/Retail%20Setup%20${version}.exe` };
  write(windows, 'manifest.json', manifest); write(android, 'manifest.json', manifest);
  return { root, windows, android, expected: { version, commit } };
}

test('beta publisher verifies both packages before publishing isolated pointers', async () => {
  const f = fixture(), objects = new Map(), writes = [];
  const store = {
    read(key) { assertBetaKey(key); return objects.get(key) || null; },
    write(file, key, immutable) { assertBetaKey(key); writes.push({ key, immutable }); objects.set(key, fs.readFileSync(file)); },
  };
  try {
    assert.throws(() => validateRelease(f.windows, f.expected.version), /stable|version/i);
    await publishBeta(f.windows, f.android, f.expected, store);
    const firstPointer = writes.findIndex(w => !w.immutable);
    assert.ok(firstPointer > writes.findIndex(w => w.key.endsWith('.apk')));
    assert.equal(JSON.parse(objects.get('pos-app/beta/manifest.json')).version, f.expected.version);
    assert.ok(objects.has(`pos-app/beta/latest/android/Retail-${f.expected.version}.apk`));
    assert.throws(() => assertBetaKey('pos-app/latest/latest.yml'));
    assert.throws(() => assertBetaKey('pos-app/beta/../latest/latest.yml'));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('failed APK verification cannot advertise a partial beta release', async () => {
  const f = fixture(), objects = new Map(), pointers = [];
  try {
    await assert.rejects(publishBeta(f.windows, f.android, f.expected, {
      read: key => key.endsWith('.apk') && objects.has(key) ? Buffer.from('corrupt') : objects.get(key) || null,
      write(file, key, immutable) { if (!immutable) pointers.push(key); objects.set(key, fs.readFileSync(file)); },
    }), /verification failed/);
    assert.deepEqual(pointers, []);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
