import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {processIdentity as proc,matchesProcess,localPlatform} from './onboarding-process.mjs';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {inspectDesktopPrerequisites} from './desktop/preflight.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {selectLoopbackPort} from './ports.mjs';
import {configSchema} from './resources.mjs';
import {createSetup} from './setup.mjs';
import {configureCodexClient} from './onboarding-client.mjs';
import {verifyInstallation} from './onboarding-verifier.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const id=z.string().regex(/^[a-z][a-z0-9-]{0,40}$/);
const deviceSchema=z.object({id,label:z.string().min(1).max(80),location:z.enum(['local','remote']),platform:z.enum(['linux','macos','windows']),containers:z.boolean().default(false),desktop:z.boolean().default(false),config_authority:z.boolean().default(false),config_pending:z.object({sha:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional(),desktop_authorized:z.boolean().default(false),desktop_client:z.enum(['not_checked','reported']).default('not_checked'),desktop_snapshot:z.string().uuid().optional(),desktop_evidence:z.object({task:z.string().min(1).max(240),result:z.string().min(1).max(240),screenshot_delivered:z.literal(true)}).strict().optional(),desktop_enabled:z.boolean().default(false),desktop_status:z.enum(['not_checked','ready','driver_unavailable','permission_denied','locked','no_session','session_unverified','unsupported']).default('not_checked'),desktop_pending:z.object({sha:z.string().regex(/^[a-f0-9]{64}$/),enabled:z.boolean(),selected:z.boolean()}).strict().optional(),host_authorized:z.boolean().default(false),containers_authorized:z.boolean().default(false),client_authorized:z.boolean().default(false),config_sha:z.string().regex(/^[a-f0-9]{64}$/).optional(),installed:z.boolean().default(false),port:z.number().int().min(1024).max(65535).optional(),port_mode:z.enum(['auto','explicit']).optional(),port_pending:z.object({mode:z.enum(['auto','explicit']).default('auto'),sha:z.string().regex(/^[a-f0-9]{64}$/),port:z.number().int().min(1024).max(65535)}).strict().optional(),endpoint_changed:z.boolean().default(false),owner:z.string().uuid().optional(),connection:z.enum(['not_checked','verified','failed']).default('not_checked'),client:z.enum(['not_checked','reported_with_artifact']).default('not_checked'),challenge:z.string().regex(/^[a-f0-9]{32}$/).optional(),process:z.object({pid:z.number().int().positive(),started:z.string(),nonce:z.string().uuid().optional()}).strict().optional()}).strict();
const stateSchema=z.object({version:z.union([z.literal(1),z.literal(2)]),installation:z.string().uuid(),machine:z.string(),client:z.enum(['codex','chatgpt']),devices:z.array(deviceSchema).max(16)}).strict();
const fail=code=>{throw Object.assign(Error(code),{code});};
async function machine(){return crypto.createHash('sha256').update([os.hostname(),process.getuid?.(),await fs.realpath(os.homedir())].join(':')).digest('hex');}
export function probe(){return {platform:process.platform,node:process.versions.node,supported:['linux','darwin'].includes(process.platform)&&process.getuid?.()>0&&Number(process.versions.node.split('.')[0])>=22,host_default:true,containers_optional:true,desktop_default:true,desktop_setup_supported:['linux','darwin'].includes(process.platform),desktop_dependency_install_automated:false,remote_aggregation_supported:false};}
async function privateDirectory(p){const st=await fs.lstat(p);if(!st.isDirectory()||(st.mode&0o077)||st.uid!==process.getuid?.())fail('private_directory_required');}
async function readState(dir){await privateDirectory(dir);const p=path.join(dir,'onboarding.json'),st=await fs.lstat(p);if(!st.isFile()||(st.mode&0o077)||st.uid!==process.getuid?.())fail('private_state_required');return stateSchema.parse(JSON.parse(await fs.readFile(p,'utf8')));}
async function save(dir,state){const tmp=path.join(dir,'.state-'+crypto.randomUUID());try{await fs.writeFile(tmp,JSON.stringify({...state,version:2,devices:state.devices.map(d=>{const saved={...d};if(d.installed&&d.config_authority)for(const key of ['port','port_mode','desktop','desktop_enabled','containers'])delete saved[key];return saved;})},null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(tmp,path.join(dir,'onboarding.json'));}finally{await fs.unlink(tmp).catch(()=>{});}}
const desktopDriver=platform=>({linux:'hyprland',macos:'peekaboo',windows:'winapp'})[platform];
const digest=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const paths=(dir,d)=>({base:path.join(dir,d.id),project:path.join(dir,d.id,'project'),privateDir:path.join(dir,d.id,'private'),configFile:path.join(dir,d.id,'private','config.json')});
function next(d){
 if(d.effective_error)return {kind:'blocked',code:'configuration_changed',message:'Runtime configuration must be reconciled before proceeding.'};
 if(d.location==='remote')return {kind:'user_action',code:'continue_on_device',message:'Open a local agent on this device and run the same onboarding entrypoint. This runtime does not aggregate remote Hosts.'};
 if(!['linux','macos'].includes(d.platform))return {kind:'unsupported',code:'native_installer_unavailable',message:'Native Host installation for this platform is not available. Other devices can continue.'};
 if(!d.host_authorized||d.containers&&!d.containers_authorized)return {kind:'authorization',code:'host_access',message:'Host commands run with the local account permissions; a Project folder is not a shell sandbox. Optional containers are a separate capability.'};
 if(!d.installed)return {kind:'script',code:'install'};
 if(d.desktop&&!d.desktop_enabled)return {kind:'authorization',code:'enable_desktop',message:'Desktop access can observe screen content and operate applications. Enable only with explicit consent, or defer desktop.'};
 if(d.connection!=='verified')return {kind:'script',code:'start_then_verify'};
 if(d.client==='not_checked')return {kind:'client_handoff',code:'connect_and_test',message:'Connect the chosen client, then perform the generated first-task test from that client.'};
 if(d.desktop&&d.desktop_status!=='ready')return {kind:'script',code:'check_desktop',message:'Check installed driver, OS permissions and active session; missing dependencies and permissions require separate setup.'};
 if(d.desktop&&d.desktop_client!=='reported')return {kind:'client_handoff',code:'desktop_client_test',message:'From the chosen client, perform an authorized desktop task, observe its result, and deliver a screenshot. Report the task, observed result and snapshot only after that actual client flow succeeds.'};
 return {kind:'complete',code:d.desktop?'host_desktop_ready':'host_ready',message:d.desktop?'Host task artifact checked; Desktop readiness checked and client task/result/screenshot reported (client attestation, not independently verified).':'Host task artifact checked; Desktop explicitly deferred.'};
}
export function summary(state){return {version:1,client:state.client,devices:state.devices.map(d=>({id:d.id,label:d.label,location:d.location,platform:d.platform,configuration_state:d.effective_error?'unavailable':d.installed?'verified':'not_installed',capabilities:{host:d.effective_error?null:true,containers:d.effective_error?null:d.containers,desktop:d.effective_error?'unknown':d.desktop?(d.desktop_enabled?d.desktop_status:'selected_not_enabled'):'deferred'},desktop_driver:d.configured_driver??desktopDriver(d.platform),desktop_authorized:d.desktop_authorized,desktop_client:d.desktop_client,container_verification:d.containers?'separate_sandbox_only_until_client_task':'not_requested',installed:d.installed,port:d.port,port_mode:d.port_mode??(d.port?'explicit':undefined),endpoint_changed:d.endpoint_changed,...(d.endpoint_changed?{endpoint_handoff:'The local endpoint changed. Reconfigure any external tunnel or direct HTTP client, then verify it; local config-reading bridges use the updated file.'}:{}),connection:d.connection,client:d.client,next_action:next(d)})),overall:state.devices.length===0?'choose_devices':state.devices.every(d=>next(d).kind==='complete')?'complete':state.devices.some(d=>d.connection==='verified'&&d.client==='reported_with_artifact')?'partially_complete':'in_progress'};}
async function ownedProcess(d,p){if(!d.process)return false;const current=await proc(d.process.pid);return !!current&&current.started===d.process.started&&matchesProcess(current,[process.execPath,path.join(root,'scripts/onboarding-server.mjs'),p.configFile,...(d.process.nonce?[d.process.nonce]:[])]);}
function projectConfiguration(d,c){
 const grant=c.hosts[0].capabilities?.desktop;
 const values={port:c.port,port_mode:c.onboarding?.port_mode??'explicit',desktop:c.onboarding?.desktop_requested??grant?.enabled===true,desktop_enabled:grant?.enabled===true,containers:c.environments.length>0,configured_driver:grant?.driver};
 for(const [key,value]of Object.entries(values))Object.defineProperty(d,key,{value,writable:true,configurable:true,enumerable:false});
 d.config_authority=Boolean(c.onboarding);
 return c;
}
async function identity(d,p){
 await privateDirectory(p.base);await privateDirectory(p.privateDir);const st=await fs.lstat(p.configFile);
 if(!st.isFile()||(st.mode&0o077)||st.uid!==process.getuid?.())fail('configuration_changed');
 const raw=await fs.readFile(p.configFile,'utf8');if(d.config_sha&&digest(raw)!==d.config_sha)fail('configuration_changed');
 const parsed=configSchema.safeParse(JSON.parse(raw));if(!parsed.success)fail('configuration_changed');const c=parsed.data;
 const host=c.hosts[0];if(c.owner_id!==d.owner||c.hosts.length!==1||host.id!=='local'||host.project!=='default'||host.connection!=='local'||!host.enabled||!host.unsandboxed||c.projects.length!==1||c.projects[0].id!=='default'||c.projects[0].path!==p.project)fail('configuration_changed');
 if(!c.onboarding&&!d.config_authority){if((d.port!==undefined&&d.port!==c.port)||Boolean(host.capabilities?.desktop)!==d.desktop_enabled||c.environments.length!==(d.containers?1:0))fail('configuration_changed');return c;}
 if(!c.onboarding)fail('configuration_changed');return projectConfiguration(d,c);
}
async function migrateConfiguration(stateDir,state,d,p){
 const hadAuthority=d.config_authority;const c=await identity(d,p);if(c.onboarding){projectConfiguration(d,c);if(!hadAuthority)await save(stateDir,state);return;}
 c.onboarding={desktop_requested:d.desktop,port_mode:d.port_mode??'explicit'};
 const raw=JSON.stringify(c,null,2)+'\n';d.config_pending={sha:digest(raw)};await save(stateDir,state);
 const tmp=path.join(p.privateDir,'.config-'+crypto.randomUUID());
 try{await fs.writeFile(tmp,raw,{mode:0o600,flag:'wx'});await fs.rename(tmp,p.configFile);}finally{await fs.unlink(tmp).catch(()=>{});}
 d.config_sha=digest(raw);delete d.config_pending;projectConfiguration(d,c);await save(stateDir,state);
}

function invalidateConnection(d){d.connection='not_checked';d.client='not_checked';d.desktop_status='not_checked';d.desktop_client='not_checked';delete d.challenge;}
async function possibleExistingService(port){
 // Never disclose the private token to an unknown listener just to classify a conflict.
 try{const response=await fetch('http://127.0.0.1:'+port+'/healthz',{redirect:'error',signal:AbortSignal.timeout(1500)});if(!response.ok){await response.body?.cancel();return false;}const reader=response.body.getReader();let body='';try{for(;;){const {done,value}=await reader.read();if(done)break;body+=Buffer.from(value).toString();if(body.length>4096)return false;}}finally{await reader.cancel();}const data=JSON.parse(body);return data.ok===true&&data.scope==='process only';}catch{return false;}
}
async function relocatePort(stateDir,state,d,p,port,mode='auto'){
 const config=await identity(d,p);config.port=port;config.onboarding.port_mode=mode;const raw=JSON.stringify(config,null,2)+'\n';
 d.port_pending={sha:digest(raw),port,mode};await save(stateDir,state);
 const tmp=path.join(p.privateDir,'.port-'+crypto.randomUUID());
 try{await fs.writeFile(tmp,raw,{mode:0o600,flag:'wx'});await fs.rename(tmp,p.configFile);}finally{await fs.unlink(tmp).catch(()=>{});}
 d.config_sha=digest(raw);d.port=port;d.port_mode=mode;d.endpoint_changed=true;invalidateConnection(d);delete d.port_pending;await save(stateDir,state);
}
async function desktopRuntimeStatus(d,p){
 const tokenFile=path.join(p.privateDir,'token'),st=await fs.lstat(tokenFile);
 if(!st.isFile()||(st.mode&0o077)||st.uid!==process.getuid?.())fail('private_credential_required');
 const token=(await fs.readFile(tokenFile,'utf8')).trim();if(!/^[a-zA-Z0-9_-]{43,}$/.test(token))fail('private_credential_required');
 const client=new Client({name:'styx-desktop-onboarding',version:'1'},{capabilities:{}});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+d.port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token},redirect:'error'}}),{timeout:10000});
  const result=await client.callTool({name:'target_desktop_status',arguments:{target:{kind:'host',id:'local'}}},undefined,{timeout:15000});
  if(result.isError)fail('desktop_status_failed');const status=result.structuredContent??JSON.parse(result.content.find(x=>x.type==='text').text);
  if(status.driver!==(d.configured_driver??desktopDriver(d.platform)))fail('desktop_driver_mismatch');return status;
 }finally{await client.close();}
}
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
  for(const item of state.devices.filter(x=>x.config_pending&&command!=='stop')){const raw=await fs.readFile(paths(stateDir,item).configFile,'utf8');const sha=digest(raw);if(sha===item.config_pending.sha)item.config_sha=sha;else if(sha!==item.config_sha)fail('configuration_changed');delete item.config_pending;await save(stateDir,state);}
  for(const item of state.devices.filter(x=>x.port_pending&&command!=='stop')){const raw=await fs.readFile(paths(stateDir,item).configFile,'utf8');const sha=digest(raw);if(sha===item.port_pending.sha){item.config_sha=sha;item.port=item.port_pending.port;item.port_mode=item.port_pending.mode;item.endpoint_changed=true;invalidateConnection(item);}else if(sha!==item.config_sha)fail('configuration_changed');delete item.port_pending;await save(stateDir,state);}
  for(const item of state.devices.filter(x=>x.desktop_pending&&command!=='stop')){const raw=await fs.readFile(paths(stateDir,item).configFile,'utf8');const sha=digest(raw);if(sha===item.desktop_pending.sha){item.config_sha=sha;item.desktop_enabled=item.desktop_pending.enabled;item.desktop=item.desktop_pending.selected;item.desktop_status='not_checked';item.desktop_client='not_checked';item.connection='not_checked';item.client='not_checked';delete item.challenge;}else if(sha!==item.config_sha)fail('configuration_changed');delete item.desktop_pending;await save(stateDir,state);}
  if(command!=='stop')for(const item of state.devices.filter(x=>x.installed&&x.location==='local')){try{await migrateConfiguration(stateDir,state,item,paths(stateDir,item));}catch(error){if(command!=='status')throw error;Object.defineProperty(item,'effective_error',{value:true,enumerable:false});invalidateConnection(item);}}
  else for(const item of state.devices.filter(x=>x.installed&&x.location==='local')){try{await identity(item,paths(stateDir,item));}catch{Object.defineProperty(item,'effective_error',{value:true,enumerable:false});}}
  if(command==='init'){if(state.client!==options.client)fail('client_selection_conflict');return summary(state);}
  if(command==='status'){for(const d of state.devices.filter(d=>d.installed&&d.location==='local')){try{await identity(d,paths(stateDir,d));const check=await verifyInstallation({configFile:paths(stateDir,d).configFile});d.connection=check.passed?'verified':'failed';if(!check.passed){d.desktop_status='not_checked';d.desktop_client='not_checked';}else if(d.desktop_enabled){d.desktop_status='not_checked';}}catch{d.connection='failed';d.client='not_checked';}}await save(stateDir,state);return summary(state);}
  if(command==='add-device'){
   if(options.deferDesktop&&options.desktop)fail('desktop_selection_conflict');
   const d=deviceSchema.parse({id:options.id,label:options.label,location:options.location,platform:options.platform,containers:options.containers??false,desktop:options.deferDesktop?false:(options.desktop??state.devices.find(x=>x.id===options.id)?.desktop??true)});
   const existing=state.devices.find(x=>x.id===d.id);
   if(existing){for(const k of ['label','location','platform','containers','desktop'])if(existing[k]!==d[k])fail('device_selection_conflict');}
   else{if(state.devices.length>=16)fail('device_limit');if(d.location==='local'&&state.devices.some(x=>x.location==='local'))fail('local_device_already_selected');state.devices.push(d);await save(stateDir,state);}
   return summary(state);
  }
  const d=state.devices.find(x=>x.id===device);if(!d)fail('unknown_device');
  if(command==='defer-desktop'&&!d.installed){d.desktop=false;d.desktop_status='not_checked';d.desktop_client='not_checked';await save(stateDir,state);return summary(state);}
  if(d.location!=='local'||d.platform!==localPlatform(process.platform)||!probe().supported)return {ok:false,...summary(state),error:'run_supported_local_onboarding'};
  const p=paths(stateDir,d);
  if(command==='effective-config'){
   if(!d.installed)fail('install_first');const c=await identity(d,p),grant=c.hosts[0].capabilities?.desktop;
   return {version:1,source:'runtime_config',device:d.id,configuration:{port:c.port,port_mode:c.onboarding.port_mode,host:{id:c.hosts[0].id,enabled:c.hosts[0].enabled,connection:c.hosts[0].connection,unsandboxed:c.hosts[0].unsandboxed},desktop:{requested:c.onboarding.desktop_requested,enabled:grant?.enabled===true,driver:grant?.driver??null},containers:c.environments.map(e=>({id:e.id,provider:e.provider}))},reconciliation:{external_tunnel:'not_managed',os_service:'not_managed',client:'requires_verification'}};
  }
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
   // Recover a completed setup before selecting another port; never adopt unrelated files.
   if(d.owner&&d.port){try{await fs.lstat(p.configFile);await identity(d,p);d.config_sha=digest(await fs.readFile(p.configFile));d.installed=true;await save(stateDir,state);return summary(state);}catch(e){if(e.code!=='ENOENT')throw e;}}
   const mode=options.port!==undefined?'explicit':d.port_mode??'auto';
   const selectedPort=await selectLoopbackPort({preferred:options.port??d.port??8791,explicit:mode==='explicit'});
   d.owner??=crypto.randomUUID();d.port=selectedPort;d.port_mode=mode;await save(stateDir,state);
   await createSetup({project:p.project,privateDir:p.privateDir,backend:d.containers?'both':'host',port:selectedPort,desktopRequested:d.desktop,portMode:mode,ownerId:d.owner});
   const c=JSON.parse(await fs.readFile(p.configFile,'utf8'));d.installed=true;d.config_sha=crypto.createHash('sha256').update(await fs.readFile(p.configFile)).digest('hex');d.owner=c.owner_id;projectConfiguration(d,c);await save(stateDir,state);return summary(state);
  }
  if(!d.installed)fail('install_first');if(command==='stop'){await privateDirectory(p.base);await privateDirectory(p.privateDir);}else await identity(d,p);
  if(command==='start'||command==='stop'||command==='enable-desktop'||command==='defer-desktop'||command==='reconfigure-port'){
   try{const file=path.join(p.privateDir,'server-process.json'),st=await fs.lstat(file);if(!st.isFile()||(st.mode&0o077)||st.uid!==process.getuid?.())fail('process_receipt_invalid');const receipt=JSON.parse(await fs.readFile(file,'utf8'));const candidate={...d,process:receipt};if(Number.isInteger(receipt.pid)&&typeof receipt.started==='string'&&await ownedProcess(candidate,p))d.process=receipt;}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  if(command==='enable-desktop'||command==='defer-desktop'){
   const enabled=command==='enable-desktop';
   if(enabled&&options.desktopAccess!==true)fail('desktop_authorization_required');
   if(enabled===d.desktop_enabled&&d.desktop===enabled)return summary(state);
   if(await ownedProcess(d,p))fail('stop_before_desktop_change');
   // Also refuse unknown/manual listeners; never change a grant beneath a running server.
   const {createServer}=await import('node:net');const socket=createServer();await new Promise((r,j)=>{socket.once('error',()=>j(Object.assign(Error('stop_before_desktop_change'),{code:'stop_before_desktop_change'})));socket.listen(d.port,'127.0.0.1',r);});await new Promise(r=>socket.close(r));
   const config=await identity(d,p);if(enabled)config.hosts[0].capabilities={desktop:{enabled:true,driver:desktopDriver(d.platform)}};else delete config.hosts[0].capabilities;
   config.onboarding.desktop_requested=enabled;
   const raw=JSON.stringify(config,null,2)+'\n';
   if(enabled)d.desktop_authorized=true;
   d.desktop_pending={sha:digest(raw),enabled,selected:enabled};await save(stateDir,state);
   const temp=path.join(p.privateDir,'.desktop-'+crypto.randomUUID());
   try{await fs.writeFile(temp,raw,{mode:0o600,flag:'wx'});await fs.rename(temp,p.configFile);}finally{await fs.unlink(temp).catch(()=>{});}
   d.config_sha=digest(raw);projectConfiguration(d,config);d.desktop_status='not_checked';d.desktop_client='not_checked';d.connection='not_checked';d.client='not_checked';delete d.challenge;delete d.desktop_pending;await save(stateDir,state);return summary(state);
  }
  if(command==='check-desktop'||command==='confirm-desktop-test'){
   if(!d.desktop_enabled||!d.desktop_authorized)fail('desktop_authorization_required');
   if(command==='confirm-desktop-test'&&d.connection!=='verified')fail('verify_first');
   if(command==='confirm-desktop-test'&&(options.fromClient!==true||!z.string().uuid().safeParse(options.snapshotId).success))fail('desktop_client_attestation_required');
   let evidence;if(command==='confirm-desktop-test'){const parsed=z.object({task:z.string().trim().min(1).max(240),result:z.string().trim().min(1).max(240),screenshot_delivered:z.literal(true)}).safeParse({task:options.desktopTask,result:options.desktopResult,screenshot_delivered:options.screenshotDelivered});if(!parsed.success)fail('desktop_task_evidence_required');evidence=parsed.data;}
   const prerequisites=await inspectDesktopPrerequisites();
   let status;try{status=await desktopRuntimeStatus(d,p);}catch{status={ready:false,state:'session_unverified'};}
   const allowed=['driver_unavailable','permission_denied','locked','no_session','session_unverified','unsupported'];
   d.desktop_status=status.ready===true?'ready':allowed.includes(status.state)?status.state:'session_unverified';if(d.desktop_status!=='ready')d.desktop_client='not_checked';else if(command==='confirm-desktop-test'){d.desktop_client='reported';d.desktop_snapshot=options.snapshotId;d.desktop_evidence=evidence;}await save(stateDir,state);
   return {...summary(state),desktop_prerequisites:prerequisites,desktop_check:{driver:d.configured_driver??desktopDriver(d.platform),ready:d.desktop_status==='ready',state:d.desktop_status,scope:'authenticated_configured_server',prerequisites_scope:'installer_process',client_task_verified:false,client_task_attestation:d.desktop_client}};
  }
  if(command==='reconfigure-port'){
   if(await ownedProcess(d,p))fail('stop_before_port_change');
   // Explicit migration opts into automatic ports; existing pinned endpoints never change silently.
   if(await possibleExistingService(d.port))fail('existing_service_ownership_unconfirmed');
   const mode=options.port===undefined?'auto':'explicit';const port=await selectLoopbackPort({preferred:options.port??d.port,explicit:mode==='explicit'});
   if(port!==d.port||mode!==d.port_mode)await relocatePort(stateDir,state,d,p,port,mode);
   return summary(state);
  }
  if(command==='start'){
   if(await ownedProcess(d,p)){await save(stateDir,state);return summary(state);}
   // Unknown listeners are never signalled or adopted. Only auto-selected endpoints relocate.
   const port=await selectLoopbackPort({preferred:d.port,explicit:d.port_mode!=='auto'});
   if(port!==d.port){if(await possibleExistingService(d.port))fail('existing_service_ownership_unconfirmed');await relocatePort(stateDir,state,d,p,port);}
   const log=await fs.open(path.join(p.privateDir,'server.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);const logStat=await log.stat();if(!logStat.isFile()||(logStat.mode&0o077)||logStat.uid!==process.getuid?.()){await log.close();fail('private_log_required');}
   const nonce=crypto.randomUUID();
   const child=spawn(process.execPath,[path.join(root,'scripts/onboarding-server.mjs'),p.configFile,nonce],{detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,CHAT_CODEX_CONFIG:p.configFile}});
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();await log.close();
   const current=await proc(child.pid);if(!current)fail('server_exited');d.process={pid:child.pid,started:current.started,nonce};d.connection='not_checked';d.client='not_checked';d.desktop_status='not_checked';d.desktop_client='not_checked';delete d.challenge;await save(stateDir,state);
   for(let i=0;i<30;i++){if(!await ownedProcess(d,p))fail('server_exited');try{const response=await fetch('http://127.0.0.1:'+d.port+'/healthz',{signal:AbortSignal.timeout(500),redirect:'error'});await response.body?.cancel();if(response.ok)return summary(state);}catch{}await new Promise(r=>setTimeout(r,100));}fail('server_start_unconfirmed');
  }
  if(command==='stop'){
   if(d.process){if(await ownedProcess(d,p)){process.kill(d.process.pid,'SIGTERM');for(let i=0;i<100&&await ownedProcess(d,p);i++)await new Promise(r=>setTimeout(r,50));if(await ownedProcess(d,p))fail('stop_unconfirmed');}else if(await proc(d.process.pid))fail('process_identity_changed');}
   delete d.process;d.connection='not_checked';d.client='not_checked';d.desktop_status='not_checked';d.desktop_client='not_checked';delete d.challenge;await save(stateDir,state);return summary(state);
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
