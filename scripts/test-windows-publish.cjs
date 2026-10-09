const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const {retention,validateRelease}=require('./publish-windows-release.cjs');
test('retention orders semantic versions, keeps five plus pinned and recent recovery releases',()=>{
 const old='2025-01-01T00:00:00Z';const now=Date.parse('2026-10-09');
 const releases=['1.4.8','1.4.9','1.4.10','1.4.11','1.4.12','1.4.13','1.4.14'].map(version=>({version,released:old}));
 const result=retention(releases,now);assert.deepEqual(result.remove.map(r=>r.version),['1.4.9','1.4.8']);
 releases[0].pinned=true;releases[1].released=new Date(now).toISOString();assert.equal(retention(releases,now).remove.length,0);
});
test('only exact installer bytes, metadata and a present blockmap may publish',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pos-publish-test-'));
 try {
 const name='Retail Setup 1.2.3.exe';const data=Buffer.from('test installer');const hash=crypto.createHash('sha512').update(data).digest('base64');
 fs.writeFileSync(path.join(directory,name),data);fs.writeFileSync(path.join(directory,name+'.blockmap'),'blocks');
 const metadata={version:'1.2.3',path:name,sha512:hash,files:[{url:name,sha512:hash,size:data.length}]};
 fs.writeFileSync(path.join(directory,'latest.yml'),yaml.dump(metadata));assert.equal(validateRelease(directory,'1.2.3').length,2);
 fs.appendFileSync(path.join(directory,name),'corrupt');assert.throws(()=>validateRelease(directory,'1.2.3'),/SHA-512/);
 metadata.path='../malicious.exe';fs.writeFileSync(path.join(directory,'latest.yml'),yaml.dump(metadata));assert.throws(()=>validateRelease(directory,'1.2.3'),/exactly/);
 } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
