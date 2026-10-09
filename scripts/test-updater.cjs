const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
function fixture({ failCheck=false, failDownload=false, blocked=null }={}) {
  const native = new EventEmitter();
  const calls=[];
  native.setFeedURL=()=>{};
  native.checkForUpdates=async()=>{calls.push('check');if(failCheck)throw new Error('Offline');native.emit('update-available',{version:'2.0.0'});};
  native.downloadUpdate=async()=>{calls.push('download');if(failDownload) {native.emit('error',new Error('checksum mismatch'));throw new Error('checksum mismatch');}native.emit('download-progress',{percent:45,transferred:45,total:100});native.emit('update-downloaded',{version:'2.0.0'});};
  native.quitAndInstall=(silent,relaunch)=>calls.push(['install',silent,relaunch]);
  const app={getVersion:()=> '1.0.0',getPath:()=>'/sandbox',isPackaged:true};
  const output={exports:{}};
  const fakeFs={...fs,readFileSync:()=>JSON.stringify({blockedVersion:blocked}),appendFileSync:()=>{},existsSync:()=>false};
  vm.runInNewContext(fs.readFileSync(require.resolve('../electron/updater.cjs'),'utf8'),{
    require:name=>name==='electron'?{app,BrowserWindow:{getAllWindows:()=>[]},net:{}}:name==='electron-updater'?{autoUpdater:native}:name==='./net.cjs'?{explainNetworkError:raw=>({code:'ENET',friendly:raw})}:name==='node:fs'?fakeFs:require(name),
    module:output,process:{env:{},resourcesPath:'/sandbox',platform:'win32'},console:{info(){},warn(){},error(){}},Buffer,setTimeout,setImmediate,
  });
  return { updater:output.exports,native,calls };
}
test('one launch check automatically downloads, stages and never restarts',async()=>{
 const {updater,calls}=fixture();updater.start();updater.start();await updater.check();
 assert.deepEqual(calls,['check','download']);assert.equal(updater.status().status,'ready');
 assert.equal(updater.status().transferred,45);await updater.check();assert.equal(calls.length,2);
});
test('concurrent download callers reuse one verified download',async()=>{
 const {updater,calls}=fixture();await Promise.all([updater.check(),updater.check(),updater.downloadUpdate()]);assert.equal(calls.filter(x=>x==='download').length,1);
});
test('offline checks do not throw or start installation',async()=>{
 const {updater,calls}=fixture({failCheck:true});updater.start();await updater.check();assert.equal(updater.status().status,'error');assert.deepEqual(calls,['check']);
});
test('a corrupt or interrupted download is never ready or executable',async()=>{
 const {updater,calls}=fixture({failDownload:true});await updater.check();assert.equal(updater.status().status,'error');assert.equal(updater.install().ok,false);assert.deepEqual(calls,['check','download']);
});
test('installation uses the supported silent relaunch API',async()=>{
 const {updater,calls}=fixture();await updater.check();assert.equal(updater.install().ok,true);updater.install();assert.deepEqual(calls,['check','download',['install',true,true]]);
});
test('faulty version hold survives launch and prevents automatic download',async()=>{
 const {updater,calls}=fixture({blocked:'2.0.0'});await updater.check();assert.equal(updater.status().status,'unavailable');assert.deepEqual(calls,['check']);
});
test('asynchronous installer errors reopen the application through recovery callback',async()=>{
 const {updater,native}=fixture();let recovered=0;updater.onInstallFailure(()=>recovered++);await updater.check();updater.install();native.emit('error',new Error('installer failed'));assert.equal(recovered,1);assert.equal(updater.status().stage,'install');
});
