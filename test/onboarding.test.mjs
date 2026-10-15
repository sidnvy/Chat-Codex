import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {onboard} from '../src/onboarding.mjs';
const supported=process.platform==='linux'&&process.getuid?.()>0;
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-onboard-'));const stateDir=path.join(root,'state');try{await onboard('init',{stateDir,client:'codex'});await fn(stateDir);}finally{await fs.rm(root,{recursive:true,force:true});}}
const add=stateDir=>onboard('add-device',{stateDir,id:'laptop',label:'My laptop',location:'local',platform:'linux'});
test('state resumes selected devices without implicit authorization',()=>fixture(async stateDir=>{
 let result=await add(stateDir);assert.equal(result.devices[0].next_action.kind,'authorization');assert.equal(result.devices[0].capabilities.containers,false);
 result=await onboard('init',{stateDir,client:'codex'});assert.equal(result.devices.length,1);
 await assert.rejects(onboard('init',{stateDir,client:'chatgpt'}),/client_selection_conflict/);
 assert.equal((await add(stateDir)).devices.length,1);
 await assert.rejects(onboard('add-device',{stateDir,id:'laptop',label:'Changed',location:'local',platform:'linux'}),/device_selection_conflict/);
 if(supported)await assert.rejects(onboard('install',{stateDir,device:'laptop'}),/authorization_required/);
 assert.deepEqual(await fs.readdir(stateDir),['onboarding.json']);
}));
test('remote and unsupported devices are honest pending handoffs',()=>fixture(async stateDir=>{
 await onboard('add-device',{stateDir,id:'remote',label:'Other computer',location:'remote',platform:'linux'});
 const result=await onboard('add-device',{stateDir,id:'windows',label:'This computer',location:'local',platform:'windows',desktop:true});
 assert.equal(result.devices[0].next_action.code,'continue_on_device');assert.equal(result.devices[1].next_action.code,'native_installer_unavailable');assert.equal(result.overall,'in_progress');
}));
test('optional containers require their own explicit authorization',{skip:!supported},()=>fixture(async stateDir=>{
 await onboard('add-device',{stateDir,id:'laptop',label:'My laptop',location:'local',platform:'linux',containers:true});
 await assert.rejects(onboard('authorize',{stateDir,device:'laptop',hostAccess:true}),/container_authorization_required/);
 await assert.rejects(onboard('install',{stateDir,device:'laptop'}),/authorization_required/);
 assert.equal((await onboard('authorize',{stateDir,device:'laptop',hostAccess:true,containers:true})).devices[0].next_action.code,'install');
}));
test('real Host process starts verifies stops and preserves first-task boundary',{skip:!supported,timeout:40000},()=>fixture(async stateDir=>{
 await add(stateDir);await onboard('authorize',{stateDir,device:'laptop',hostAccess:true});
 const reservation=createServer();await new Promise((r,j)=>{reservation.once('error',j);reservation.listen(0,'127.0.0.1',r)});const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 await onboard('install',{stateDir,device:'laptop',port});
 let started=false;
 try{
  await onboard('start',{stateDir,device:'laptop'});started=true;
  let result;for(let i=0;i<20;i++){result=await onboard('verify',{stateDir,device:'laptop'});if(result.verification.passed)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(result.verification.passed,true);assert.equal(result.devices[0].client,'not_checked');assert.equal(result.overall,'in_progress');
  const challenge=await onboard('prepare-client-test',{stateDir,device:'laptop'});assert.equal(challenge.client_test.origin,'requires_client_attestation');
  await assert.rejects(onboard('confirm-client-test',{stateDir,device:'laptop'}),/client_attestation_required/);
  const token=(await fs.readFile(path.join(stateDir,'laptop/private/token'),'utf8')).trim();assert.ok(!JSON.stringify(challenge).includes(token));
 }finally{if(started)await onboard('stop',{stateDir,device:'laptop'});}
 const stopped=await onboard('status',{stateDir});assert.equal(stopped.devices[0].connection,'failed');assert.notEqual(stopped.overall,'complete');
}));
test('explicit lock recovery preserves active operations and clears dead owner',{skip:!supported},()=>fixture(async stateDir=>{
 const lock=path.join(stateDir,'.onboarding-lock');await fs.mkdir(lock,{mode:0o700});
 const stat=await fs.readFile('/proc/self/stat','utf8');const started=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
 const file=path.join(lock,'owner.json');await fs.writeFile(file,JSON.stringify({pid:process.pid,started}),{mode:0o600});
 await assert.rejects(onboard('recover-lock',{stateDir}),/operation_in_progress/);
 await assert.rejects(onboard('status',{stateDir}),/operation_in_progress/);
 await fs.writeFile(file,JSON.stringify({pid:2147483647,started:'1'}));
 assert.equal((await onboard('recover-lock',{stateDir})).ok,true);
 assert.equal((await onboard('status',{stateDir})).overall,'choose_devices');
}));
test('symlink ancestor supports install resume and config drift fails closed',{skip:!supported},()=>fixture(async stateDir=>{
 const alias=path.join(path.dirname(stateDir),'alias');await fs.symlink(path.dirname(stateDir),alias);
 const viaAlias=path.join(alias,'state');await add(viaAlias);await onboard('authorize',{stateDir:viaAlias,device:'laptop',hostAccess:true});
 await onboard('install',{stateDir:viaAlias,device:'laptop'});
 assert.equal((await onboard('install',{stateDir,device:'laptop'})).devices[0].installed,true);
 const file=path.join(stateDir,'laptop/private/config.json'),config=JSON.parse(await fs.readFile(file,'utf8'));config.hosts[0].enabled=false;await fs.writeFile(file,JSON.stringify(config));
 await assert.rejects(onboard('install',{stateDir,device:'laptop'}),/configuration_changed/);
 assert.equal((await onboard('status',{stateDir})).devices[0].connection,'failed');
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).hosts[0].enabled,false);
}));
test('owned server receipt recovers lost parent progress without duplicate process',{skip:!supported,timeout:40000},()=>fixture(async stateDir=>{
 await add(stateDir);await onboard('authorize',{stateDir,device:'laptop',hostAccess:true});
 const socket=createServer();await new Promise((r,j)=>{socket.once('error',j);socket.listen(0,'127.0.0.1',r)});const port=socket.address().port;await new Promise(r=>socket.close(r));
 await onboard('install',{stateDir,device:'laptop',port});let started=false;
 try{
  await onboard('start',{stateDir,device:'laptop'});started=true;
  const receiptFile=path.join(stateDir,'laptop/private/server-process.json');let receipt;
  for(let i=0;i<100;i++){try{receipt=JSON.parse(await fs.readFile(receiptFile,'utf8'));break;}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,30));}
  assert.ok(receipt);
  const stateFile=path.join(stateDir,'onboarding.json'),state=JSON.parse(await fs.readFile(stateFile,'utf8'));delete state.devices[0].process;await fs.writeFile(stateFile,JSON.stringify(state));
  await onboard('start',{stateDir,device:'laptop'});
  assert.equal(JSON.parse(await fs.readFile(stateFile,'utf8')).devices[0].process.pid,receipt.pid);
  const configFile=path.join(stateDir,'laptop/private/config.json');const config=JSON.parse(await fs.readFile(configFile,'utf8'));config.hosts[0].enabled=false;await fs.writeFile(configFile,JSON.stringify(config));
  assert.equal((await onboard('status',{stateDir})).devices[0].connection,'failed');
  // Ownership still permits revocation after the configuration has drifted.
  await onboard('stop',{stateDir,device:'laptop'});started=false;
  await assert.rejects(fetch('http://127.0.0.1:'+port+'/healthz',{signal:AbortSignal.timeout(1000)}));
  assert.equal(JSON.parse(await fs.readFile(configFile,'utf8')).hosts[0].enabled,false);
 }finally{if(started)await onboard('stop',{stateDir,device:'laptop'});}
}));
test('invalid port cannot corrupt resumable installation state',{skip:!supported},()=>fixture(async stateDir=>{
 await add(stateDir);await onboard('authorize',{stateDir,device:'laptop',hostAccess:true});
 await assert.rejects(onboard('install',{stateDir,device:'laptop',port:NaN}),/invalid_port/);
 const state=await onboard('status',{stateDir});assert.equal(state.devices[0].next_action.code,'install');
}));
