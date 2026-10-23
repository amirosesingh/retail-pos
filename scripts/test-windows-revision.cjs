const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), yaml = require('js-yaml');
const { finalizeWindowsRevision } = require('./finalize-windows-revision.cjs');
test('revision installer preserves verified bytes and cannot overwrite artifacts', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pos-revision-'));
 try {
  const name='Retail Setup 1.4.77.exe', bytes=Buffer.from('installer');
  const sha512=crypto.createHash('sha512').update(bytes).digest('base64');
  fs.writeFileSync(path.join(dir,name),bytes);fs.writeFileSync(path.join(dir,name+'.blockmap'),'map');
  const meta={version:'1.4.77',path:name,sha512,files:[{url:name,sha512,size:bytes.length}]};
  fs.writeFileSync(path.join(dir,'latest.yml'),yaml.dump(meta));
  const version='1.4.77+revision.1', output=`Retail Setup ${version}.exe`;
  fs.writeFileSync(path.join(dir,output),'existing');
  assert.throws(()=>finalizeWindowsRevision(dir,version),/already exists/);
  fs.unlinkSync(path.join(dir,output));
  finalizeWindowsRevision(dir,version);
  assert.deepEqual(fs.readFileSync(path.join(dir,output)),bytes);
  assert.equal(yaml.load(fs.readFileSync(path.join(dir,'latest.yml'),'utf8')).version,version);
  finalizeWindowsRevision(dir,version);
  fs.appendFileSync(path.join(dir,output),'corrupt');
  assert.throws(()=>finalizeWindowsRevision(dir,version),/SHA-512/);
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
