import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {createSetup} from './setup.mjs';
import {configureCodexClient} from './onboarding-client.mjs';
import {verifyInstallation} from './onboarding-verifier.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const id=z.string().regex(/^[a-z][a-z0-9-]{0,40}$/);
const deviceSchema=z.object({id,label:z.string().min(1).max(80),location:z.enum(['local','remote']),platform:z.enum(['linux','macos','windows']),containers:z.boolean(),desktop:z.boolean(),host_authorized:z.boolean().default(false),containers_authorized:z.boolean().default(false),client_authorized:z.boolean().default(false),config_sha:z.string().regex(/^[a-f0-9]{64}$/).optional(),installed:z.boolean().default(false),port:z.number().int().min(1024).max(65535).optional(),owner:z.string().uuid().optional(),connection:z.enum(['not_checked','verified','failed']).default('not_checked'),client:z.enum(['not_checked','reported_with_artifact']).default('not_checked'),challenge:z.string().regex(/^[a-f0-9]{32}$/).optional(),process:z.object({pid:z.number().int().positive(),started:z.string()}).strict().optional()}).strict();
const stateSchema=z.object({version:z.literal(1),installation:z.string().uuid(),machine:z.string(),client:z.enum(['codex','chatgpt']),devices:z.array(deviceSchema).max(16)}).strict();
const fail=code=>{throw Object.assign(Error(code),{code});};
async function machine(){return crypto.createHash('sha256').update([os.hostname(),process.getuid?.(),await fs.realpath(os.homedir())].join(':')).digest('hex');}
export function probe(){return {platform:process.platform,node:process.versions.node,supported:process.platform==='linux'&&process.getuid?.()>0&&Number(process.versions.node.split('.')[0])>=22,host_default:true,containers_optional:true,desktop_setup_supported:false,remote_aggregation_supported:false};}
async function privateDirectory(p){const st=await fs.lstat(p);if(!st.isDirectory()||(st.mode&0o077)||st.uid!==process.getuid?.())fail('private_directory_required');}
async function readState(dir){await privateDirectory(dir);const p=path.join(dir,'onboarding.json'),st=await fs.lstat(p);if(!st.isFile()||(st.mode&0o077)||st.uid!==process.getuid?.())fail('private_state_required');return stateSchema.parse(JSON.parse(await fs.readFile(p,'utf8')));}
async function save(dir,state){const tmp=path.join(dir,'.state-'+crypto.randomUUID());try{await fs.writeFile(tmp,JSON.stringify(state,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(tmp,path.join(dir,'onboarding.json'));}finally{await fs.unlink(tmp).catch(()=>{});}}
const paths=(dir,d)=>({base:path.join(dir,d.id),project:path.join(dir,d.id,'project'),privateDir:path.join(dir,d.id,'private'),configFile:path.join(dir,d.id,'private','config.json')});
function next(d){
 if(d.location==='remote')return {kind:'user_action',code:'continue_on_device',message:'Open a local agent on this device and run the same onboarding entrypoint. This runtime does not aggregate remote Hosts.'};
 if(d.platform!=='linux')return {kind:'unsupported',code:'native_installer_unavailable',message:'Native Host installation for this platform is not available. Other devices can continue.'};
 if(!d.host_authorized||d.containers&&!d.containers_authorized)return {kind:'authorization',code:'host_access',message:'Host commands run with the local account permissions; a Project folder is not a shell sandbox. Optional containers are a separate capability.'};
 if(!d.installed)return {kind:'script',code:'install'};
 if(d.connection!=='verified')return {kind:'script',code:'start_then_verify'};
 if(d.client==='not_checked')return {kind:'client_handoff',code:'connect_and_test',message:'Connect the chosen client, then perform the generated first-task test from that client.'};
 if(d.desktop)return {kind:'unsupported',code:'desktop_setup_pending',message:'Host is ready; requested desktop setup is not implemented by this installer.'};
 return {kind:'complete',code:'host_ready',message:'Host connection verified and a client-reported task artifact checked. Optional desktop setup remains separate.'};
}
export function summary(state){return {version:1,client:state.client,devices:state.devices.map(d=>({id:d.id,label:d.label,location:d.location,platform:d.platform,capabilities:{host:true,containers:d.containers,desktop:d.desktop?'requested_not_enabled':'disabled'},container_verification:d.containers?'separate_sandbox_only_until_client_task':'not_requested',installed:d.installed,connection:d.connection,client:d.client,next_action:next(d)})),overall:state.devices.length===0?'choose_devices':state.devices.every(d=>next(d).kind==='complete')?'complete':state.devices.some(d=>d.connection==='verified'&&d.client==='reported_with_artifact')?'partially_complete':'in_progress'};}
async function proc(pid){try{const stat=await fs.readFile('/proc/'+pid+'/stat','utf8');return {started:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19],args:(await fs.readFile('/proc/'+pid+'/cmdline','utf8')).split('\0')};}catch{return null;}}
async function ownedProcess(d,p){if(!d.process)return false;const current=await proc(d.process.pid);return !!current&&current.started===d.process.started&&current.args[0]===process.execPath&&current.args[1]===path.join(root,'scripts/onboarding-server.mjs')&&current.args[2]===p.configFile;}
async function identity(d,p){await privateDirectory(p.base);await privateDirectory(p.privateDir);const st=await fs.lstat(p.configFile);if(!st.isFile()||(st.mode&0o077)||st.uid!==process.getuid?.())fail('configuration_changed');const raw=await fs.readFile(p.configFile,'utf8');if(d.config_sha&&crypto.createHash('sha256').update(raw).digest('hex')!==d.config_sha)fail('configuration_changed');const c=JSON.parse(raw);if(c.owner_id!==d.owner||c.port!==d.port||c.hosts.length!==1||JSON.stringify(c.hosts)!==JSON.stringify([{id:'local',project:'default',enabled:true,connection:'local',unsandboxed:true}])||c.environments.length!==(d.containers?1:0)||c.projects.length!==1||c.projects[0].path!==p.project)fail('configuration_changed');return c;}
export async function onboard(command,{stateDir,device,...options}={}){
 if(command==='probe')return probe();
 if(!stateDir||!path.isAbsolute(stateDir))fail('absolute_state_directory_required');
 stateDir=path.resolve(stateDir);
 if(command==='init'){
  if(!['codex','chatgpt'].includes(options.client))fail('choose_client');
  try{await fs.mkdir(stateDir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  await privateDirectory(stateDir);
 }
 await privateDirectory(stateDir);stateDir=await fs.realpath(stateDir);
 const lock=path.join(stateDir,'.onboarding-lock');
 if(command==='recover-lock'){
  await privateDirectory(lock);let owner;try{owner=JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));}catch{fail('lock_identity_unconfirmed');}if(!Number.isInteger(owner.pid)||typeof owner.started!=='string')fail('lock_identity_unconfirmed');const current=await proc(owner.pid);if(owner.started==='unknown')fail('lock_identity_unconfirmed');if(current?.started===owner.started)fail('operation_in_progress');await fs.unlink(path.join(lock,'owner.json'));await fs.rmdir(lock);return {ok:true,next_action:'resume_status'};
 }
 try{await fs.mkdir(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')fail('operation_in_progress');throw e;}
 try{
  const self=await proc(process.pid);await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,started:self?.started??'unknown'}),{mode:0o600,flag:'wx'});
  let state;
  try{state=await readState(stateDir);}catch(e){if(command!=='init'||e.code!=='ENOENT')throw e;state={version:1,installation:crypto.randomUUID(),machine:await machine(),client:options.client,devices:[]};await save(stateDir,state);}
  if(state.machine!==await machine())fail('state_belongs_to_another_machine');
  if(command==='init'){if(state.client!==options.client)fail('client_selection_conflict');return summary(state);}
  if(command==='status'){for(const d of state.devices.filter(d=>d.installed&&d.location==='local')){try{await identity(d,paths(stateDir,d));const check=await verifyInstallation({configFile:paths(stateDir,d).configFile});d.connection=check.passed?'verified':'failed';}catch{d.connection='failed';d.client='not_checked';}}await save(stateDir,state);return summary(state);}
  if(command==='add-device'){
   const d=deviceSchema.parse({id:options.id,label:options.label,location:options.location,platform:options.platform,containers:options.containers??false,desktop:options.desktop??false});
   const existing=state.devices.find(x=>x.id===d.id);
   if(existing){for(const k of ['label','location','platform','containers','desktop'])if(existing[k]!==d[k])fail('device_selection_conflict');}
   else{if(state.devices.length>=16)fail('device_limit');if(d.location==='local'&&state.devices.some(x=>x.location==='local'))fail('local_device_already_selected');state.devices.push(d);await save(stateDir,state);}
   return summary(state);
  }
  const d=state.devices.find(x=>x.id===device);if(!d)fail('unknown_device');
  if(d.location!=='local'||d.platform!=='linux'||!probe().supported)return {ok:false,...summary(state),error:'run_supported_local_onboarding'};
  const p=paths(stateDir,d);
  if(command==='authorize'){
   if(options.hostAccess!==true)fail('host_authorization_required');
   if(d.containers&&options.containers!==true)fail('container_authorization_required');
   d.host_authorized=true;d.containers_authorized=d.containers;await save(stateDir,state);return summary(state);
  }
  if(command==='install'){
   if(!d.host_authorized||d.containers&&!d.containers_authorized)fail('authorization_required');
   if(d.installed){await identity(d,p);return summary(state);}
   try{await fs.mkdir(p.base,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
   await privateDirectory(p.base);
   // Existing unrecorded config may belong to an interrupted or unrelated installation; never adopt it silently.
   const selectedPort=d.port??options.port??8791;
   if(!Number.isInteger(selectedPort)||selectedPort<1024||selectedPort>65535)fail('invalid_port');
   d.owner??=crypto.randomUUID();d.port=selectedPort;await save(stateDir,state);
   try{await fs.lstat(p.configFile);await identity(d,p);d.config_sha=crypto.createHash('sha256').update(await fs.readFile(p.configFile)).digest('hex');d.installed=true;await save(stateDir,state);return summary(state);}catch(e){if(e.code!=='ENOENT')throw e;}
   await createSetup({project:p.project,privateDir:p.privateDir,backend:d.containers?'both':'host',port:selectedPort,ownerId:d.owner});
   const c=JSON.parse(await fs.readFile(p.configFile,'utf8'));d.installed=true;d.config_sha=crypto.createHash('sha256').update(await fs.readFile(p.configFile)).digest('hex');d.owner=c.owner_id;d.port=c.port;await save(stateDir,state);return summary(state);
  }
  if(!d.installed)fail('install_first');if(command==='stop'){await privateDirectory(p.base);await privateDirectory(p.privateDir);}else await identity(d,p);
  if(command==='start'||command==='stop'){
   try{const file=path.join(p.privateDir,'server-process.json'),st=await fs.lstat(file);if(!st.isFile()||(st.mode&0o077)||st.uid!==process.getuid?.())fail('process_receipt_invalid');const receipt=JSON.parse(await fs.readFile(file,'utf8'));const candidate={...d,process:receipt};if(Number.isInteger(receipt.pid)&&typeof receipt.started==='string'&&await ownedProcess(candidate,p))d.process=receipt;}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  if(command==='start'){
   if(await ownedProcess(d,p)){await save(stateDir,state);return summary(state);}
   // A responding process with another config must not be adopted or replaced.
   const {createServer}=await import('node:net');const reservation=createServer();await new Promise((resolve,reject)=>{reservation.once('error',()=>reject(Object.assign(Error('port_in_use'),{code:'port_in_use'})));reservation.listen(d.port,'127.0.0.1',resolve);});await new Promise(r=>reservation.close(r));
   const log=await fs.open(path.join(p.privateDir,'server.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);const logStat=await log.stat();if(!logStat.isFile()||(logStat.mode&0o077)||logStat.uid!==process.getuid?.()){await log.close();fail('private_log_required');}
   const child=spawn(process.execPath,[path.join(root,'scripts/onboarding-server.mjs'),p.configFile],{detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,CHAT_CODEX_CONFIG:p.configFile}});
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();await log.close();
   const current=await proc(child.pid);if(!current)fail('server_exited');d.process={pid:child.pid,started:current.started};d.connection='not_checked';d.client='not_checked';delete d.challenge;await save(stateDir,state);
   for(let i=0;i<30;i++){if(!await ownedProcess(d,p))fail('server_exited');try{const response=await fetch('http://127.0.0.1:'+d.port+'/healthz',{signal:AbortSignal.timeout(500),redirect:'error'});await response.body?.cancel();if(response.ok)return summary(state);}catch{}await new Promise(r=>setTimeout(r,100));}fail('server_start_unconfirmed');
  }
  if(command==='stop'){
   if(d.process){if(await ownedProcess(d,p)){process.kill(d.process.pid,'SIGTERM');for(let i=0;i<100&&await ownedProcess(d,p);i++)await new Promise(r=>setTimeout(r,50));if(await ownedProcess(d,p))fail('stop_unconfirmed');}else if(await proc(d.process.pid))fail('process_identity_changed');}
   delete d.process;d.connection='not_checked';d.client='not_checked';delete d.challenge;await save(stateDir,state);return summary(state);
  }
  if(command==='verify'){
   const check=await verifyInstallation({configFile:p.configFile,sandbox:d.containers});d.connection=check.passed?'verified':'failed';await save(stateDir,state);return {...summary(state),verification:check};
  }
  if(command==='connect-codex'){
   if(state.client!=='codex')fail('wrong_client');
   if(!d.client_authorized&&options.clientAccess!==true)fail('client_authorization_required');
   d.client_authorized=true;await save(stateDir,state);
   const result=configureCodexClient({configFile:p.configFile,name:'styx-'+d.id});
   return {...summary(state),client_connection:result};
  }
  if(command==='prepare-client-test'){
   if(d.connection!=='verified')fail('verify_first');
   d.challenge??=crypto.randomBytes(16).toString('hex');await save(stateDir,state);
   return {...summary(state),client_test:{target:{kind:'host',id:'local'},path:'.styx-onboarding-'+d.challenge+'.txt',content:d.challenge,command:"printf '%s' '"+d.challenge+"' > .styx-onboarding-"+d.challenge+".txt",instruction:'From the intended Chat client, use target_exec with the generated command on Host local, then target_read_file to read it back. Confirm the displayed device/connection is the selected one. Run confirm-client-test only after that actual client task succeeds.',origin:'requires_client_attestation'}};
  }
  if(command==='confirm-client-test'){
   if(d.client==='reported_with_artifact')return summary(state);
   if(options.fromClient!==true||!d.challenge)fail('client_attestation_required');
   const f=path.join(p.project,'.styx-onboarding-'+d.challenge+'.txt'),st=await fs.lstat(f);if(!st.isFile()||st.size>100)fail('client_artifact_invalid');if(await fs.readFile(f,'utf8')!==d.challenge)fail('client_artifact_invalid');
   const check=await verifyInstallation({configFile:p.configFile});if(!check.passed){d.connection='failed';await save(stateDir,state);return {...summary(state),verification:check};}
   d.client='reported_with_artifact';await save(stateDir,state);await fs.unlink(f);return summary(state);
  }
  fail('unknown_command');
 }finally{await fs.unlink(path.join(lock,'owner.json')).catch(()=>{});await fs.rmdir(lock);}
}
