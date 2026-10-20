const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { publishIosBeta } = require('./publish-ios-beta.cjs');
test('unsigned IPA publication is immutable, beta-only and verifies uploaded bytes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-beta-publish-'));
  const file = path.join(dir, 'app.ipa');
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]);
  fs.writeFileSync(file, bytes);
  const objects = new Map();
  const store = {
    read: async key => objects.get(key),
    write: async (source, key) => objects.set(key, fs.readFileSync(source)),
  };
  try {
    await assert.rejects(publishIosBeta(file, '1.4.75', 'a'.repeat(40), store), /identity/);
    await publishIosBeta(file, '1.4.75-beta.1', 'a'.repeat(40), store);
    const key = [...objects.keys()][0];
    assert.equal(key, 'pos-app/beta/releases/beta-v1.4.75-beta.1-aaaaaaa/ios/Retail-1.4.75-beta.1-unsigned.ipa');
    await publishIosBeta(file, '1.4.75-beta.1', 'a'.repeat(40), store);
    objects.set(key, Buffer.from('different'));
    await assert.rejects(publishIosBeta(file, '1.4.75-beta.1', 'a'.repeat(40), store), /overwrite/);
    objects.clear();
    await assert.rejects(publishIosBeta(file, '1.4.75-beta.1', 'a'.repeat(40), { read: store.read, write: async () => objects.set(key, Buffer.from('corrupt')) }), /verification/);
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});
