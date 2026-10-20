const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { iosReleaseConfig, prepareIosProject } = require('./ios-release-config.cjs');
const { publishIosStable } = require('./publish-ios-stable.cjs');
const base = require('../ios-ota.public.json');
test('stable and beta retain separate native identities and OTA channels', () => {
  assert.equal(iosReleaseConfig('beta', base).trust, base);
  const stable = iosReleaseConfig('stable', base);
  assert.equal(stable.appId, 'com.luckycharms.pos');
  assert.equal(stable.trust.channel, 'production');
  assert.equal(stable.trust.publicKey, base.publicKey);
  assert.match(stable.trust.endpoint, /\/production\/manifest.json$/);
  assert.throws(() => iosReleaseConfig('unknown', base));
});
test('preparing the application never changes framework bundle identifiers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-stable-'));
  const project = path.join(root, 'ios/App/App.xcodeproj');
  const app = path.join(root, 'ios/App/App');
  fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(app, { recursive: true });
  const file = path.join(project, 'project.pbxproj');
  fs.writeFileSync(file, 'PRODUCT_BUNDLE_IDENTIFIER = com.luckycharms.pos.beta;\nPRODUCT_BUNDLE_IDENTIFIER = com.luckycharms.pos.beta;\nPRODUCT_BUNDLE_IDENTIFIER = org.plugin.framework;');
  fs.writeFileSync(path.join(app, 'Info.plist'), '<key>CFBundleDisplayName</key><string>Retail Beta</string>');
  prepareIosProject(root, iosReleaseConfig('stable', base));
  assert.equal(fs.readFileSync(file, 'utf8').match(/com.luckycharms.pos;/g).length, 2);
  assert.match(fs.readFileSync(file, 'utf8'), /org.plugin.framework/);
  prepareIosProject(root, iosReleaseConfig('beta', base));
  assert.equal(fs.readFileSync(file, 'utf8').match(/com.luckycharms.pos.beta;/g).length, 2);
  // Only exact, freshly-created fixture files are removed.
  fs.unlinkSync(file); fs.unlinkSync(path.join(app, 'Info.plist'));
  fs.rmdirSync(project); fs.rmdirSync(app); fs.rmdirSync(path.dirname(app)); fs.rmdirSync(path.join(root, 'ios')); fs.rmdirSync(root);
});
test('stable IPA publication verifies bytes and rejects prereleases and overwrites', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-publish-'));
  const file = path.join(dir, 'app.ipa');
  fs.writeFileSync(file, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]));
  let bytes = null, key;
  const store = { remote: async () => bytes, upload: async (f, k) => { key = k; bytes = fs.readFileSync(f); } };
  try {
    await assert.rejects(publishIosStable(file, '1.4.75-beta.1', 'a'.repeat(40), store), /identity/);
    await publishIosStable(file, '1.4.75', 'a'.repeat(40), store);
    assert.equal(key, 'releases/v1.4.75-aaaaaaa/ios/Retail-1.4.75-unsigned.ipa');
    bytes = Buffer.from('bad');
    await assert.rejects(publishIosStable(file, '1.4.75', 'a'.repeat(40), store), /overwrite/);
  } finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
});
