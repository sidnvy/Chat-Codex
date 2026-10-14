import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runDoctor} from '../src/doctor.mjs';

const image='node:22-bookworm-slim@sha256:'+'a'.repeat(64);
async function fixture(t,{withDocker=true}={}){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'chat-codex-doctor-test-'));
 t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const priv=path.join(base,'private'),project=path.join(base,'project');
 await fs.mkdir(priv,{mode:0o700});await fs.mkdir(project,{mode:0o700});
 const configFile=path.join(priv,'config.json'),tokenFile=path.join(priv,'token');
 const config={
  version:2,owner_id:crypto.randomUUID(),port:8791,
  projects:[{id:'default',path:project}],hosts:[],
  environments:withDocker?[{id:'dev',project:'default',provider:'docker'}]:[],
  ...(withDocker?{docker:{user:'1000:1000',image}}:{})
 };
 await fs.writeFile(configFile,JSON.stringify(config),{mode:0o600});
 await fs.writeFile(tokenFile,'SECRET_NEVER_PRINT_IN_DOCTOR',{mode:0o600});
 const seen=[];
 const command=async(binary,args)=>{
  seen.push([binary,...args]);
  if(binary!=='docker')throw Error('Unexpected executable');
  return {stdout:'fixture',stderr:''};
 };
 const http=async(url,options)=>{
  seen.push(['http',url,options.method]);
  return {ok:true,async json(){return {ok:true,scope:'process only'}}};
 };
 const opts={configFile,platform:'linux',nodeVersion:'22.10.0',uid:1000,command,http};
 return {priv,project,configFile,tokenFile,config,opts,seen};
}
const status=(result,id)=>result.checks.find(c=>c.id===id)?.status;

test('doctor is read-only, reports secure Docker golden path and never returns token content',async t=>{
 const {opts,seen}=await fixture(t);
 const report=await runDoctor(opts);
 assert.equal(report.overall,'ready');
 for(const id of ['platform','node','privileges','configuration','private_directory','credential_file','project:default','docker','docker_image','local_server'])assert.equal(status(report,id),'ready',id);
 assert.equal(status(report,'desktop'),'not_checked');
 assert.equal(status(report,'chatgpt_connection'),'not_checked');
 assert.ok(seen.some(x=>x[0]==='docker'&&x[1]==='info'));
 assert.ok(seen.some(x=>x[0]==='docker'&&x[1]==='image'&&x[2]==='inspect'));
 assert.ok(seen.some(x=>x[0]==='http'&&x[1]==='http://127.0.0.1:8791/healthz'));
 const printed=JSON.stringify(report);
 assert.equal(printed.includes('SECRET_NEVER_PRINT_IN_DOCTOR'),false);
 assert.equal(printed.includes(opts.configFile),false);
 assert.equal(printed.includes('Bearer'),false);
});
test('doctor before setup provides action-required guidance without modifying files',async()=>{
 const report=await runDoctor({configFile:null,platform:'linux',nodeVersion:'22.3.0',uid:1000,
  command:async()=>{throw Error('docker_unavailable')},http:async()=>{throw Error('should_not_http')}});
 assert.equal(report.overall,'action_required');
 assert.equal(status(report,'configuration'),'action_required');
 assert.equal(status(report,'docker'),'action_required');
 assert.equal(status(report,'local_server'),'not_checked');
});
test('doctor fails closed on schema errors and unsafe credentials',async t=>{
 const f=await fixture(t);
 await fs.chmod(f.tokenFile,0o644);
 let r=await runDoctor(f.opts);
 assert.equal(status(r,'credential_file'),'blocked');
 assert.equal(r.overall,'blocked');
 await fs.chmod(f.tokenFile,0o600);
 await fs.writeFile(f.configFile,JSON.stringify({...f.config,hosts:[{id:'surprise',connection:'ssh',enabled:true}]}),{mode:0o600});
 r=await runDoctor(f.opts);
 assert.equal(status(r,'configuration'),'blocked');
 assert.equal(r.overall,'blocked');
 assert.equal(JSON.stringify(r).includes('surprise'),false);
});
test('doctor does not silently require Docker for an explicitly Host-only config',async t=>{
 const f=await fixture(t,{withDocker:false});
 const report=await runDoctor({...f.opts,command:async()=>{throw Error('Docker missing')}});
 assert.equal(status(report,'docker'),'warning');
 assert.equal(status(report,'docker_image'),'not_checked');
 assert.equal(report.overall,'ready');
});
test('doctor reports unsupported OS/root and does not claim a healthy server proves auth',async t=>{
 const f=await fixture(t);
 const report=await runDoctor({...f.opts,platform:'win32',uid:0,
  http:async()=>({ok:true,json:async()=>({ok:true,scope:'process only'})})});
 assert.equal(report.overall,'blocked');
 assert.equal(status(report,'platform'),'blocked');
 assert.equal(status(report,'privileges'),'blocked');
 assert.equal(status(report,'local_server'),'ready');
 assert.match(report.checks.find(x=>x.id==='local_server').message,/not an MCP authentication test/);
});
test('doctor executable emits parseable, secret-free JSON and rejects unknown flags',()=>{
 const script=new URL('../scripts/doctor.mjs',import.meta.url).pathname;
 const env={...process.env,CHAT_CODEX_CONFIG:''};
 const read=spawnSync(process.execPath,[script,'--json'],{env,encoding:'utf8',timeout:10000});
 assert.equal(read.status,2);
 const parsed=JSON.parse(read.stdout);
 assert.equal(parsed.schema_version,1);
 assert.equal(parsed.overall,'action_required');
 assert.equal(parsed.checks.some(c=>c.id==='configuration'),true);
 assert.equal(read.stdout.includes('SECRET_NEVER_PRINT_IN_DOCTOR'),false);
 const invalid=spawnSync(process.execPath,[script,'--unexpected'],{env,encoding:'utf8',timeout:10000});
 assert.equal(invalid.status,2);
 assert.match(invalid.stderr,/Usage:/);
});
test('doctor rejects structurally valid config that the actual Registry cannot admit',async t=>{
 const f=await fixture(t);
 const extra=path.join(f.project,'child');
 await fs.mkdir(extra);
 const cases=[
  ['missing Docker settings',{...f.config,docker:undefined}],
  ['wrong Project reference',{...f.config,environments:[{id:'dev',project:'unknown',provider:'docker'}]}],
  ['relative Project directory',{...f.config,projects:[{id:'default',path:'relative/project'}]}],
  ['Project inside private directory',{...f.config,projects:[{id:'default',path:f.priv}]}],
  ['overlapping Project roots',{...f.config,projects:[{id:'default',path:f.project},{id:'child',path:extra}]}]
 ];
 for(const [label,invalid] of cases){
  await fs.writeFile(f.configFile,JSON.stringify(invalid),{mode:0o600});
  const report=await runDoctor(f.opts);
  assert.equal(status(report,'configuration'),'blocked',label);
  assert.equal(report.overall,'blocked',label);
  assert.equal(JSON.stringify(report).includes('unknown'),false,'Private catalog identity must not leak');
 }
});
test('doctor distinguishes the configured Styx process from an unrelated HTTP responder',async t=>{
 const f=await fixture(t);
 const wrong=await runDoctor({...f.opts,http:async()=>({
  ok:true,json:async()=>({ok:true,scope:'unrelated process'})
 })});
 assert.equal(status(wrong,'local_server'),'action_required');
 assert.equal(wrong.overall,'action_required');
 const legit=await runDoctor({...f.opts,http:async()=>({
  ok:true,json:async()=>({ok:true,scope:'process only'})
 })});
 assert.equal(status(legit,'local_server'),'ready');
});
