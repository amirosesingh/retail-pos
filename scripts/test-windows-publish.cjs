const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const {retention,validateRelease}=require('./publish-windows-release.cjs');
const {remote}=require('./publish-windows-release.cjs');
test('temporary CDN rejection retries without accepting the error page as metadata',async()=>{
 let attempts=0;
 const body=await remote('https://example.invalid/latest.yml',{fetchImpl:async()=>++attempts<3?new Response('blocked',{status:403}):new Response('version: 1.2.3'),sleep:async()=>{}});
 assert.equal(body.toString(),'version: 1.2.3');assert.equal(attempts,3);
});
test('persistent CDN denial is not interpreted as an absent release',async()=>{
 let attempts=0;
 await assert.rejects(remote('https://example.invalid/latest.yml',{optional:true,fetchImpl:async()=>{attempts++;return new Response('blocked',{status:403});},sleep:async()=>{}}),/HTTP 403/);
 assert.equal(attempts,3);
});
test('range validation still rejects a full response instead of partial content',async()=>{
 await assert.rejects(remote('https://example.invalid/setup.exe',{range:true,fetchImpl:async()=>new Response('x'),sleep:async()=>{}}),/byte ranges/);
});
for (const originOnly of [false,true]) test(`authenticated verification cleans temporary bytes (origin-only: ${originOnly})`,async()=>{
 const vm=require('node:vm');const output={exports:{}};let downloaded;
 const wrappedRequire=name=>name==='node:child_process'?{execFileSync:(_bin,args)=>{
   assert.equal(args[0],'s3api');assert.equal(args[args.indexOf('--key')+1],'pos-app/latest/setup.exe');
   downloaded=args.at(-3);fs.writeFileSync(downloaded,'x');
   return JSON.stringify({ContentLength:1,ContentRange:'bytes 0-0/5'});
 }}:require(name);
 vm.runInNewContext(fs.readFileSync(require.resolve('./publish-windows-release.cjs'),'utf8'),{
   require:wrappedRequire,module:output,process:{env:{R2_VERIFY_ORIGIN:String(originOnly),R2_ENDPOINT:'https://example.invalid',AWS_ACCESS_KEY_ID:'test',AWS_SECRET_ACCESS_KEY:'test'}},
   URL,Buffer,AbortSignal,fetch,console:{warn(){}},setTimeout,
 });
 const result=await output.exports.remote('https://updatecms.luckycharmsdnbhd.com/pos-app/latest/setup.exe',{
   range:true,fetchImpl:async()=>{assert.equal(originOnly,false,'Origin verification must never probe the public CDN');return new Response('blocked',{status:403});},sleep:async()=>{},
 });
 assert.equal(result.toString(),'x');assert.equal(fs.existsSync(downloaded),false);
});
test('workflow numbering mismatch is rejected before any upload',async()=>{
 const previous=process.env.RELEASE_VERSION;process.env.RELEASE_VERSION='1.4.46';
 try { await assert.rejects(require('./publish-windows-release.cjs').publish('unused','1.4.47','v1.4.47-abcdef0'),/release number/); }
 finally { if(previous===undefined)delete process.env.RELEASE_VERSION;else process.env.RELEASE_VERSION=previous; }
});
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
