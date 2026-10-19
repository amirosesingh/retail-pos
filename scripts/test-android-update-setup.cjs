const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureUpdateDownload } = require('./android-update-setup.cjs');

for (const packageName of ['com.luckycharms.pos', 'com.luckycharms.pos.beta']) {
  test(`registers the downloader once before bridge creation for ${packageName}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-android-setup-'));
    try {
      const folder = path.join(root, 'android/app/src/main/java', ...packageName.split('.'));
      fs.mkdirSync(folder, { recursive: true });
      const activity = path.join(folder, 'MainActivity.java');
      fs.writeFileSync(activity, `package ${packageName};\nimport com.getcapacitor.BridgeActivity;\npublic class MainActivity extends BridgeActivity {}`);
      configureUpdateDownload(root);
      configureUpdateDownload(root);
      const source = fs.readFileSync(activity, 'utf8');
      assert.equal(source.match(/registerPlugin\(/g).length, 1);
      assert.ok(source.indexOf('registerPlugin(') < source.indexOf('super.onCreate('));
      assert.ok(fs.readFileSync(path.join(root, 'android/app/src/main/java/com/luckycharms/pos/PosUpdateDownloadPlugin.java'), 'utf8').includes('DownloadManager'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
