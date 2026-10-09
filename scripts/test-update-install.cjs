const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateInstall } = require('../electron/update-install.cjs');
function setup({sync=true,installed=true}={}) {
 const calls=[];
 const run=createUpdateInstall({updater:{status:()=>({status:'ready'}),downloadUpdate:async()=>{calls.push('download');return {status:'ready'};},install:async()=>{calls.push('install');return {ok:installed};}},prepare:async()=>{calls.push('sync');return {ok:sync,error:'Cloud is offline'};},allowQuit:()=>calls.push('allow'),recover:()=>calls.push('recover')});
 return {run,calls};
}
test('one click downloads, flushes sync and then hands off installation',async()=>{const {run,calls}=setup();assert.equal((await run(true)).ok,true);assert.deepEqual(calls,['download','sync','allow','install']);});
test('pending offline synchronization never launches an installer',async()=>{const {run,calls}=setup({sync:false});assert.equal((await run(false)).ok,false);assert.deepEqual(calls,['sync','recover']);});
test('installer failure reopens writes and retry performs synchronization again',async()=>{const {run,calls}=setup({installed:false});await run(false);await run(false);assert.equal(calls.filter(c=>c==='recover').length,2);assert.equal(calls.filter(c=>c==='sync').length,2);});
test('simultaneous clicks share a single installation',async()=>{const {run,calls}=setup();await Promise.all([run(true),run(false)]);assert.equal(calls.filter(c=>c==='install').length,1);});
test('busy payment or printer rejects before synchronization or installation',async()=>{
 const calls=[];const run=createUpdateInstall({updater:{status:()=>({status:'ready'})},isBusy:()=>true,prepare:async()=>calls.push('sync'),allowQuit:()=>calls.push('quit'),recover:()=>calls.push('recover')});
 assert.deepEqual(await run(false),{ok:false,code:'EPOS_BUSY',error:'Please finish the current transaction before updating.'});assert.deepEqual(calls,[]);
});
test('renderer safety refusal leaves installation staged and permits a later safe retry',async()=>{
 let busy=true;let installs=0;
 const run=createUpdateInstall({updater:{status:()=>({status:'ready'}),install:()=>{installs++;return {ok:true};}},prepare:async forUpdate=>({ok:forUpdate&&!busy,error:'Please finish the current transaction before updating.'}),allowQuit(){},recover(){}});
 assert.equal((await run(false)).ok,false);assert.equal(installs,0);busy=false;assert.equal((await run(false)).ok,true);assert.equal(installs,1);
});
