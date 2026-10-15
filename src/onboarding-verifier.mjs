import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createServer} from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createRegistry} from './resources.mjs';
import {start} from './server.mjs';
import {createSetup} from './setup.mjs';
const requireTrue=(value)=>{if(!value)throw Error('verification_failed');};
async function credentials(file){
 requireTrue(typeof file==='string'&&path.isAbsolute(file));
 const directory=path.dirname(file);
 for(const [name,isDir] of [[directory,true],[file,false],[path.join(directory,'token'),false]]){
  const st=await fs.lstat(name);requireTrue((isDir?st.isDirectory():st.isFile())&&(st.mode&0o077)===0&&st.uid===process.getuid?.());
 }
 const raw=JSON.parse(await fs.readFile(file,'utf8'));
 await createRegistry(raw,file,{warnHostAccess:false});
 const token=(await fs.readFile(path.join(directory,'token'),'utf8')).trim();
 requireTrue(/^[a-zA-Z0-9_-]{43,}$/.test(token));
 return {raw,token};
}
async function connect(file){
 const {raw,token}=await credentials(file),url=new URL('http://127.0.0.1:'+raw.port+'/mcp');
 for(const auth of [undefined,'Bearer invalid']){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:auth}:{})},body:'{}',signal:AbortSignal.timeout(5000),redirect:'error'});
  requireTrue(r.status===401);await r.body?.cancel();
 }
 const client=new Client({name:'styx-first-run-verifier',version:'1'},{capabilities:{}});
 try{
  await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+token}}}),{timeout:10000});
  const names=(await client.listTools({}, {timeout:10000})).tools.map(t=>t.name);
  for(const name of ['host_list','environment_list','project_list','target_exec'])requireTrue(names.includes(name));
  return client;
 }catch(error){await client.close().catch(()=>{});throw error;}
}
async function call(client,name,args={},expectedError=false){
 const r=await client.callTool({name,arguments:args},undefined,{timeout:35000});
 requireTrue(expectedError?r.isError===true:r.isError!==true);return r.structuredContent;
}
async function port(){const s=createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve)});const p=s.address().port;await new Promise(r=>s.close(r));return p;}
// Track server-side completion: MCP cancellation does not cancel provider lifecycle work.
export function trackLifecycle(router){
 const pending=new Set(),original=router.lifecycle.bind(router);
 router.lifecycle=(...args)=>{const work=Promise.resolve().then(()=>original(...args));pending.add(work);work.then(()=>pending.delete(work),()=>pending.delete(work));return work;};
 return async(timeoutMs=60000)=>{
  let timer;
  try{return await Promise.race([(async()=>{while(pending.size)await Promise.allSettled([...pending]);return true;})(),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);}
  finally{clearTimeout(timer);}
 };
}
/** Never provisions configured targets. Sandbox uses a distinct private owner/project/server. */
export async function verifyInstallation({configFile,sandbox=false,scratchRoot=os.tmpdir(),deadlineMs=120000,signal}={}){
 const result={schema_version:1,passed:false,connection:'not_checked',sandbox:'not_checked',chatgpt_account:'not_checked',desktop:'not_checked',cleanup:'not_needed'};
 let phase='arguments',client,owned,instance,sandboxClient,identity,settleLifecycle,created=false,ambiguousMutation=false;
 const end=Date.now()+deadlineMs;
 const bounded=()=>{if(signal?.aborted)throw Object.assign(Error('interrupted'),{code:'interrupted'});if(Date.now()>=end)throw Object.assign(Error('deadline'),{code:'deadline_exceeded'});};
 try{
  requireTrue(Boolean(configFile)||sandbox);requireTrue(Number.isInteger(deadlineMs)&&deadlineMs>0&&deadlineMs<=180000);
  bounded();
  if(configFile){
   phase='configured_connection';client=await connect(configFile);bounded();
   for(const name of ['host_list','environment_list','project_list']){bounded();await call(client,name);bounded();}
   result.connection='verified';await client.close();client=undefined;
  }
  if(sandbox){
   phase='sandbox_setup';bounded();requireTrue(process.platform==='linux'&&process.getuid?.()>0);
   owned=await fs.mkdtemp(path.join(scratchRoot,'styx-first-run-'));
   const project=path.join(owned,'project'),priv=path.join(owned,'private'),file=path.join(priv,'config.json');
   await createSetup({project,privateDir:priv,backend:'docker',port:await port()});
   bounded();instance=await start(file);settleLifecycle=trackLifecycle(instance.router);bounded();sandboxClient=await connect(file);bounded();
   const target={kind:'environment',id:'dev'};
   const run=async(name,args={},expected=false)=>{bounded();phase=name;const mutating=/^environment_(create|start|stop|delete)$/.test(name)||['target_exec','target_write_file'].includes(name);if(mutating)ambiguousMutation=true;const value=await call(sandboxClient,name,args,expected);if(mutating)ambiguousMutation=false;bounded();return value};
   requireTrue((await run('environment_status',{environment:'dev'})).lifecycle==='absent');
   // Unique setup owner_id and private Project mean even ambiguous create can be reconciled safely.
   created=true;await run('environment_create',{environment:'dev'});
   const entry=instance.registry.environments.get('dev'),proj=instance.registry.projects.get('default');
   identity=(await instance.router.docker.inspect(entry,proj))?.Id;requireTrue(identity);
   await run('environment_start',{environment:'dev'});
   const text='Styx first run '+crypto.randomBytes(8).toString('hex')+'\n';
   await run('target_write_file',{target,path:'receipt.txt',content:text});
   requireTrue((await run('target_read_file',{target,path:'receipt.txt'})).result.content===text);
   await run('target_write_file',{target,path:'sum.mjs',content:'export const sum=(a,b)=>a-b;\n'});
   await run('target_write_file',{target,path:'sum.test.mjs',content:"import assert from 'node:assert/strict';import {sum} from './sum.mjs';assert.equal(sum(2,3),5);\n"});
   requireTrue((await run('target_exec',{target,command:'node sum.test.mjs'},true)).exit_code===1);
   await run('target_write_file',{target,path:'sum.mjs',content:'export const sum=(a,b)=>a+b;\n'});
   requireTrue((await run('target_exec',{target,command:'node sum.test.mjs'})).exit_code===0);
   await run('environment_stop',{environment:'dev'});await run('environment_start',{environment:'dev'});
   requireTrue((await instance.router.docker.inspect(entry,proj))?.Id===identity);
   requireTrue((await run('target_read_file',{target,path:'receipt.txt'})).result.content===text);
   await run('environment_delete',{environment:'dev'});created=false;
   requireTrue((await run('environment_status',{environment:'dev'})).lifecycle==='absent');
   requireTrue(await fs.readFile(path.join(project,'receipt.txt'),'utf8')===text);
   bounded();result.sandbox='verified';result.sandbox_evidence={authenticated_mcp:true,real_docker:true,red_green:true,restart_identity:true,project_retained:true,separate_from_configured_server:true};
  }
  bounded();result.passed=true;
 }catch(error){result.failure={phase,code:['interrupted','deadline_exceeded'].includes(error.code)?error.code:'verification_failed'};}
 finally{
  let safe=!ambiguousMutation;
  for(const connection of [client,sandboxClient]){try{await connection?.close();}catch{safe=false;}}
  // Never inspect absence/delete data while an earlier create could still complete.
  try{if(settleLifecycle&&!await settleLifecycle())safe=false;}catch{safe=false;}
  if(instance&&created&&safe){
   try{const entry=instance.registry.environments.get('dev'),proj=instance.registry.projects.get('default');const current=await instance.router.docker.inspect(entry,proj);if(current){requireTrue(!identity||identity===current.Id);await instance.router.lifecycle('delete','dev');}requireTrue((await instance.router.status({kind:'environment',id:'dev'})).lifecycle==='absent');}catch{safe=false;}
  }
  if(instance){try{instance.server.closeAllConnections();await new Promise((resolve,reject)=>instance.server.close(error=>error?reject(error):resolve()));}catch{safe=false;}}
  if(owned&&safe){try{await fs.rm(owned,{recursive:true,force:true});result.cleanup='verified';}catch{safe=false;}}
  if(!safe){result.cleanup='unconfirmed';result.passed=false;result.failure={phase:'cleanup',code:'owned_resources_retained'};if(owned)result.recovery_directory=owned;}

 }
 return result;
}
