const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const cli = path.resolve(__dirname, '../node_modules/@capgo/cli/dist/index.js');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retail-ota-packaging-'));
  try {
    const web = path.join(dir, 'web');
    fs.mkdirSync(web);
    const zip = path.join(dir, 'bundle.zip');
    const pack = () => spawnSync(process.execPath, [cli, 'bundle', 'zip',
      'com.luckycharms.pos.beta', '--path', web, '--bundle', '1.0.0-beta.1',
      '--name', zip, '--json'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    run({ web, zip, pack });
  } finally {
    // Only delete the unique temporary directory created by this test.
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('retail-ota-packaging-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('official CLI packages a local OTA shell with a matching SHA-256 checksum', () => {
  fixture(({ web, zip, pack }) => {
    fs.writeFileSync(path.join(web, 'index.html'), '<script src="app.js"></script>');
    fs.writeFileSync(path.join(web, 'app.js'), 'CapacitorUpdater.notifyAppReady();');
    const result = pack();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const jsonStart = result.stdout.indexOf('{');
    assert.ok(jsonStart >= 0, result.stdout);
    const metadata = JSON.parse(result.stdout.slice(jsonStart));
    const bytes = fs.readFileSync(zip);
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.equal(metadata.bundle, '1.0.0-beta.1');
    assert.equal(metadata.checksum, crypto.createHash('sha256').update(bytes).digest('hex'));
  });
});

test('official CLI refuses a shell without its root index.html', () => {
  fixture(({ web, zip, pack }) => {
    fs.writeFileSync(path.join(web, 'app.js'), 'CapacitorUpdater.notifyAppReady();');
    const result = pack();
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /index\.html/i);
    assert.equal(fs.existsSync(zip), false);
  });
});
