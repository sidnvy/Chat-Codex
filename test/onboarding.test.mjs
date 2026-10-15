import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {onboard} from '../src/onboarding.mjs';
import {processIdentity,matchesProcess,localPlatform} from '../src/onboarding-process.mjs';
const supported=['linux','darwin'].includes(process.platform)&&process.getuid?.()>0;
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'styx-onboard-'));const stateDir=path.join(root,'state');try{await onboard('init',{stateDir,client:'codex'});await fn(stateDir);}finally{await fs.rm(root,{recursive:true,force:true});}}
const add=stateDir=>onboard('add-device',{stateDir,id:'laptop',label:'My laptop',location:'local',platform:localPlatform(process.platform)});
test('state resumes selected devices without implicit authorization',()=>fixture(async stateDir=>{
 let result=await add(stateDir);assert.equal(result.devices[0].next_action.kind,'authorization');assert.equal(result.devices[0].capabilities.containers,false);
 result=await onboard('init',{stateDir,client:'codex'});assert.equal(result.devices.length,1);
 await assert.rejects(onboard('init',{stateDir,client:'chatgpt'}),/client_selection_conflict/);
 assert.equal((await add(stateDir)).devices.length,1);
 await assert.rejects(onboard('add-device',{stateDir,id:'laptop',label:'Changed',location:'local',platform:localPlatform(process.platform)}),/device_selection_conflict/);
 if(supported)await assert.rejects(onboard('install',{stateDir,device:'laptop'}),/authorization_required/);
 assert.deepEqual(await fs.readdir(stateDir),['onboarding.json']);
}));
test('remote and unsupported devices are honest pending handoffs',()=>fixture(async stateDir=>{
 await onboard('add-device',{stateDir,id:'remote',label:'Other computer',location:'remote',platform:localPlatform(process.platform)});
 const result=await onboard('add-device',{stateDir,id:'windows',label:'This computer',location:'local',platform:'windows',desktop:true});
 assert.equal(result.devices[0].next_action.code,'continue_on_device');assert.equal(result.devices[1].next_action.code,'native_installer_unavailable');assert.equal(result.overall,'in_progress');
}));
test('optional containers require their own explicit authorization',{skip:!supported},()=>fixture(async stateDir=>{
 await onboard('add-device',{stateDir,id:'laptop',label:'My laptop',location:'local',platform:localPlatform(process.platform),containers:true});
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
 const {started}=await processIdentity(process.pid);
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
  // An interrupted Desktop grant must not prevent stopping a drifted owned server.
  const pending=JSON.parse(await fs.readFile(stateFile,'utf8'));pending.devices[0].desktop_pending={sha:'0'.repeat(64),enabled:true,selected:true};pending.devices[0].port_pending={sha:'f'.repeat(64),port:54321,mode:'auto'};await fs.writeFile(stateFile,JSON.stringify(pending));
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
test('Darwin process identity requires stable start time and exact executable/command',async()=>{
 const expected=['/private/node','/app/onboarding-server.mjs','/private/config.json'];
 const values={lstart:'Thu Oct 15 10:20:30 2026',comm:expected[0],command:expected.join(' ')};
 const command=(exe,args)=>{assert.equal(exe,'/bin/ps');return values[args.at(-1).slice(0,-1)]+'\n';};
 const identity=await processIdentity(123,{platform:'darwin',command,alive:()=>true});assert.equal(matchesProcess(identity,expected),true);
 assert.equal(matchesProcess({...identity,executable:'/different/node'},expected),false);
 assert.equal(matchesProcess({...identity,commandLine:values.command+' extra'},expected),false);
 let starts=0;await assert.rejects(processIdentity(123,{platform:'darwin',command:(exe,args)=>args.at(-1)==='lstart='?String(++starts):'x',alive:()=>true}),/process_identity_unconfirmed/);
 await assert.rejects(processIdentity(123,{platform:'darwin',command:()=>{throw Error('private raw ps error')},alive:()=>true}),/process_identity_unconfirmed/);
 assert.equal(await processIdentity(123,{platform:'darwin',command:()=>{throw Error()},alive:()=>false}),null);
});
test('Linux exact argv rejects extra arguments and process inspection failures fail closed',async()=>{
 assert.equal(matchesProcess({args:['/node','/server','/config','']},['/node','/server','/config']),true);
 assert.equal(matchesProcess({args:['/node','/server','/config','extra','']},['/node','/server','/config']),false);
 await assert.rejects(processIdentity(123,{platform:'linux',readFile:async()=>{throw Error()},alive:()=>true}),/process_identity_unconfirmed/);
});
test('Desktop defaults to selection without consent and explicit defer preserves Host',{skip:!supported},()=>fixture(async stateDir=>{
 const selected=await add(stateDir);assert.equal(selected.devices[0].capabilities.desktop,'selected_not_enabled');assert.equal(selected.devices[0].desktop_authorized,false);
 await onboard('authorize',{stateDir,device:'laptop',hostAccess:true});await onboard('install',{stateDir,device:'laptop'});
 const file=path.join(stateDir,'laptop/private/config.json'),original=await fs.readFile(file,'utf8');
 await assert.rejects(onboard('enable-desktop',{stateDir,device:'laptop'}),/desktop_authorization_required/);assert.equal(await fs.readFile(file,'utf8'),original);
 const deferred=await onboard('defer-desktop',{stateDir,device:'laptop'});assert.equal(deferred.devices[0].capabilities.desktop,'deferred');assert.equal(deferred.devices[0].installed,true);assert.equal(await fs.readFile(file,'utf8'),original);assert.equal((await add(stateDir)).devices[0].capabilities.desktop,'deferred');
}));
test('Desktop grant changes require stopped service and invalidate readiness',{skip:!supported,timeout:30000},()=>fixture(async stateDir=>{
 await add(stateDir);await onboard('authorize',{stateDir,device:'laptop',hostAccess:true});
 const socket=createServer();await new Promise((r,j)=>{socket.once('error',j);socket.listen(0,'127.0.0.1',r)});const port=socket.address().port;await new Promise(r=>socket.close(r));
 await onboard('install',{stateDir,device:'laptop',port});let started=false;
 try{
  await onboard('start',{stateDir,device:'laptop'});started=true;
  await assert.rejects(onboard('enable-desktop',{stateDir,device:'laptop',desktopAccess:true}),/stop_before_desktop_change/);
  await onboard('stop',{stateDir,device:'laptop'});started=false;
  const enabled=await onboard('enable-desktop',{stateDir,device:'laptop',desktopAccess:true});assert.equal(enabled.devices[0].capabilities.desktop,'not_checked');assert.equal(enabled.devices[0].desktop_client,'not_checked');assert.equal(enabled.devices[0].connection,'not_checked');
  const file=path.join(stateDir,'laptop/private/config.json');assert.equal(JSON.parse(await fs.readFile(file)).hosts[0].capabilities.desktop.driver,process.platform==='darwin'?'peekaboo':'hyprland');
  assert.equal((await onboard('install',{stateDir,device:'laptop'})).devices[0].installed,true);
  await assert.rejects(onboard('confirm-desktop-test',{stateDir,device:'laptop'}),/verify_first/);
  await onboard('defer-desktop',{stateDir,device:'laptop'});assert.equal(JSON.parse(await fs.readFile(file)).hosts[0].capabilities,undefined);
  assert.equal((await onboard('install',{stateDir,device:'laptop'})).devices[0].installed,true);
 }finally{if(started)await onboard('stop',{stateDir,device:'laptop'});}
}));
test('authenticated server desktop readiness alone never claims client task completion',{skip:!supported,timeout:30000},()=>fixture(async stateDir=>{
 const {start}=await import('../src/server.mjs');const {DesktopDriverCatalog}=await import('../src/desktop/drivers.mjs');
 await add(stateDir);await onboard('authorize',{stateDir,device:'laptop',hostAccess:true});
 const socket=createServer();await new Promise((r,j)=>{socket.once('error',j);socket.listen(0,'127.0.0.1',r)});const port=socket.address().port;await new Promise(r=>socket.close(r));
 await onboard('install',{stateDir,device:'laptop',port});await onboard('enable-desktop',{stateDir,device:'laptop',desktopAccess:true});
 const driver=process.platform==='darwin'?'peekaboo':'hyprland';let probes=0;
 const catalog=new DesktopDriverCatalog().register(driver,()=>({status:async()=>{probes++;return {driver,ready:true,state:'ready',session_id:'test-session',capabilities:[]}},observe:async()=>{throw Error('must not observe automatically')},act:async()=>{throw Error('must not act automatically')}}));
 const server=await start(path.join(stateDir,'laptop/private/config.json'),{desktopCatalog:catalog});
 try{
  await onboard('verify',{stateDir,device:'laptop'});
  const checked=await onboard('check-desktop',{stateDir,device:'laptop'});assert.ok(probes>0);assert.equal(checked.desktop_check.scope,'authenticated_configured_server');assert.equal(checked.desktop_check.ready,true);assert.equal(checked.devices[0].desktop_client,'not_checked');assert.notEqual(checked.overall,'complete');
  await assert.rejects(onboard('confirm-desktop-test',{stateDir,device:'laptop',fromClient:true,snapshotId:'11111111-1111-4111-8111-111111111111'}),/desktop_task_evidence_required/);
  const reported=await onboard('confirm-desktop-test',{stateDir,device:'laptop',fromClient:true,snapshotId:'11111111-1111-4111-8111-111111111111',desktopTask:'Test-only attestation',desktopResult:'Synthetic report used to test the attestation boundary',screenshotDelivered:true});
  assert.equal(reported.devices[0].desktop_client,'reported');assert.equal(reported.desktop_check.client_task_verified,false);assert.notEqual(reported.overall,'complete','Host client task still missing');
 }finally{server.server.closeAllConnections();await new Promise(r=>server.server.close(r));}
}));
async function occupiedPort(){const server=createHttpServer((request,response)=>{response.writeHead(404);response.end('unrelated-listener');});await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});return {server,port:server.address().port,close:()=>new Promise(r=>server.close(r))};}
test('auto install resumes occupied uninstalled selection without disturbing listener',{skip:!supported},()=>fixture(async stateDir=>{
 const occupied=await occupiedPort();try{
  await add(stateDir);await onboard('authorize',{stateDir,device:'laptop',hostAccess:true});
  const file=path.join(stateDir,'onboarding.json'),state=JSON.parse(await fs.readFile(file));state.devices[0].port=occupied.port;await fs.writeFile(file,JSON.stringify(state));
  const result=await onboard('install',{stateDir,device:'laptop'});assert.notEqual(result.devices[0].port,occupied.port);assert.equal(result.devices[0].port_mode,'auto');assert.equal(occupied.server.listening,true);
 }finally{await occupied.close();}
}));
test('auto start relocates collision while explicit endpoint remains pinned',{skip:!supported,timeout:30000},()=>fixture(async stateDir=>{
 await add(stateDir);await onboard('authorize',{stateDir,device:'laptop',hostAccess:true});const installed=await onboard('install',{stateDir,device:'laptop'});const oldPort=installed.devices[0].port;
 const unrelated=createHttpServer((request,response)=>{response.writeHead(404);response.end('unrelated');});await new Promise((r,j)=>{unrelated.once('error',j);unrelated.listen(oldPort,'127.0.0.1',r)});let started=false;
 try{
  const result=await onboard('start',{stateDir,device:'laptop'});started=true;assert.notEqual(result.devices[0].port,oldPort);assert.equal(result.devices[0].endpoint_changed,true);assert.match(result.devices[0].endpoint_handoff,/external tunnel/);assert.equal(unrelated.listening,true);
  const verified=await onboard('verify',{stateDir,device:'laptop'});assert.equal(verified.verification.passed,true);
  await assert.rejects(onboard('reconfigure-port',{stateDir,device:'laptop'}),/stop_before_port_change/);
  await onboard('stop',{stateDir,device:'laptop'});started=false;
  const config=JSON.parse(await fs.readFile(path.join(stateDir,'laptop/private/config.json')));assert.equal(config.port,result.devices[0].port);
 }finally{if(started)await onboard('stop',{stateDir,device:'laptop'});await new Promise(r=>unrelated.close(r));}
}));
test('explicit busy install does not write config',{skip:!supported},()=>fixture(async stateDir=>{
 const occupied=await occupiedPort();try{
  await add(stateDir);await onboard('authorize',{stateDir,device:'laptop',hostAccess:true});
  await assert.rejects(onboard('install',{stateDir,device:'laptop',port:occupied.port}),e=>e.code==='port_in_use');assert.equal(occupied.server.listening,true);
  await assert.rejects(fs.stat(path.join(stateDir,'laptop/private/config.json')),{code:'ENOENT'});
 }finally{await occupied.close();}
}));
test('manual existing Styx service is never duplicated or reconfigured by collision recovery',{skip:!supported},()=>fixture(async stateDir=>{
 const {start}=await import('../src/server.mjs');await add(stateDir);await onboard('authorize',{stateDir,device:'laptop',hostAccess:true});await onboard('install',{stateDir,device:'laptop'});
 const file=path.join(stateDir,'laptop/private/config.json'),before=await fs.readFile(file,'utf8');const server=await start(file);
 try{await assert.rejects(onboard('start',{stateDir,device:'laptop'}),/existing_service_ownership_unconfirmed/);await assert.rejects(onboard('reconfigure-port',{stateDir,device:'laptop'}),/existing_service_ownership_unconfirmed/);assert.equal(await fs.readFile(file,'utf8'),before);assert.equal(server.server.listening,true);}finally{server.server.closeAllConnections();await new Promise(r=>server.server.close(r));}
}));
test('legacy pinned endpoint changes only through explicit migration',{skip:!supported},()=>fixture(async stateDir=>{
 const occupied=await occupiedPort();const port=occupied.port;await occupied.close();await add(stateDir);await onboard('authorize',{stateDir,device:'laptop',hostAccess:true});await onboard('install',{stateDir,device:'laptop',port});
 const stateFile=path.join(stateDir,'onboarding.json'),state=JSON.parse(await fs.readFile(stateFile));delete state.devices[0].port_mode;await fs.writeFile(stateFile,JSON.stringify(state));
 const listener=createHttpServer((request,response)=>{response.writeHead(404);response.end('unrelated');});await new Promise((r,j)=>{listener.once('error',j);listener.listen(port,'127.0.0.1',r)});
 try{await assert.rejects(onboard('start',{stateDir,device:'laptop'}),e=>e.code==='port_in_use');const result=await onboard('reconfigure-port',{stateDir,device:'laptop'});assert.notEqual(result.devices[0].port,port);assert.equal(result.devices[0].port_mode,'auto');assert.equal(listener.listening,true);}finally{await new Promise(r=>listener.close(r));}
}));
