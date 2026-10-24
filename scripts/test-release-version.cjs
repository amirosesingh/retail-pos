const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareRelease, displayVersion } = require('./release-version.cjs');
test('stable revisions preserve base version and compare numerically', () => {
  assert.equal(displayVersion('1.4.77+revision.1'), '1.4.77 (1)');
  assert.equal(compareRelease('1.4.77+revision.1', '1.4.77'), 1);
  assert.equal(compareRelease('1.4.77+revision.10', '1.4.77+revision.2'), 1);
  assert.equal(compareRelease('1.4.77+revision.1', '1.4.78'), -1);
  assert.equal(compareRelease('1.4.77', '1.4.77+revision.1'), -1);
  assert.equal(compareRelease('1.4.77+other.1', '1.4.77'), 0);
  assert.equal(compareRelease('1.4.77-beta.2', '1.4.77-beta.1'), 1);
});

test('release preparation needs no installed packages and is repeatable', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pos-version-test-'));
  try {
    for (const file of ['scripts/bump-version.cjs', 'scripts/release-version.cjs',
      'electron/db/installer-source.cjs', 'database/sqlserver/retail-pos-local-database.sql']) {
      const destination = path.join(dir, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(__dirname, '..', file), destination);
    }
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.4.77+revision.1' }));
    const run = () => execFileSync(process.execPath, ['scripts/bump-version.cjs', '--write'], { cwd: dir, env: { ...process.env, NODE_PATH: '' } });
    run();
    const sql = fs.readFileSync(path.join(dir, 'database/sqlserver/retail-pos-local-database.sql'), 'utf8');
    assert.match(sql, /Application version: 1\.4\.77\+revision\.1\r?\n/);
    run();
    assert.equal(fs.readFileSync(path.join(dir, 'database/sqlserver/retail-pos-local-database.sql'), 'utf8'), sql);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
