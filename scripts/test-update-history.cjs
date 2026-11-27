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

test('history keeps stable revisions in numeric order', () => {
  const versions = ['1.4.77', '1.4.77+revision.2', '1.4.78', '1.4.77+revision.10'];
  assert.deepEqual(parseHistory(JSON.stringify({releases:versions.map(version=>({version,status:'successful'}))})).map(r=>r.version), ['1.4.78','1.4.77+revision.10','1.4.77+revision.2','1.4.77']);
});

test('the web-first release hold defers stable publication until an explicit dispatch', () => {
  const fs = require('node:fs');
  const version = fs.readFileSync(require.resolve('../.github/workflows/version-release.yml'), 'utf8');
  const platforms = fs.readFileSync(require.resolve('../.github/workflows/platform-release.yml'), 'utf8');
  assert.match(version, /name: Commit and tag release version\s+if: steps\.ready\.outputs\.release == 'true'\s+run:/);
  assert.match(version, /name: Start platform release builds\s+if: steps\.ready\.outputs\.release == 'true' && vars\.RETAIL_PRODUCTION_WEB_FIRST != 'true'/);
  assert.match(platforms, /web_and_sql_verified:\s+description:[^\r\n]+\s+type: boolean\s+default: false/);
  assert.match(platforms, /publish:\s+if: >-\s+vars\.RETAIL_PRODUCTION_WEB_FIRST != 'true' \|\|\s+\(github\.event_name == 'workflow_dispatch' && inputs\.web_and_sql_verified == true\)\s+needs: \[windows, android, ios\]/);
  assert.match(platforms, /Validate matching platform artifacts[\s\S]+Publish verified Windows package and shared update pointers/);
});
