const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHistory } = require('../electron/update-history.cjs');
test('history shows successful stable releases in numeric order without executable links', () => {
  const rows = parseHistory(JSON.stringify({releases:[
    {version:'1.9.0',status:'successful',notes:'Previous',url:'https://untrusted.invalid/setup.exe'},
    {version:'1.10.0',status:'successful',released:'2026-10-09'},
    {version:'2.0.0-beta',status:'successful'}, {version:'3.0.0',status:'failed'},
  ]}));
  assert.deepEqual(rows.map(r=>r.version),['1.10.0','1.9.0']);
  assert.equal(rows[1].url,undefined);
});
test('malformed history fails closed and display text is bounded', () => {
  assert.throws(()=>parseHistory('{'));
  assert.throws(()=>parseHistory('{"releases":{}}'));
  assert.equal(parseHistory(JSON.stringify({releases:[{version:'1.0.0',status:'successful',notes:'x'.repeat(5000)}]}))[0].notes.length,4000);
});
test('platform release workflows cannot recursively delete shared recovery folders', () => {
  const fs=require('node:fs');
  const android=fs.readFileSync(require.resolve('../.github/workflows/android-apk.yml'),'utf8');
  const windows=fs.readFileSync(require.resolve('../.github/workflows/desktop-release.yml'),'utf8');
  const publisher=fs.readFileSync(require.resolve('./publish-windows-release.cjs'),'utf8');
  assert.ok(!android.includes('aws s3 rm'));
  assert.ok(!android.includes('aws s3 cp release-assets/manifest.json s3://updatelccms/pos-app/manifest.json'));
  assert.ok(!publisher.includes("'--recursive'"));
  for (const workflow of [android,windows]) assert.match(workflow,/group: pos-release/);
});
