import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const exec=promisify(execFile);
const helper=await fs.readFile(new URL('./worker.mjs',import.meta.url),'utf8');
const runDocker=async(args,timeout=15000)=> (await exec('docker',args,{timeout,maxBuffer:262144})).stdout.trim();
const cleanId=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,20);
export function environmentContainerArgs(config,project,id,containerName){
 return ['create','--pull','never','--name',containerName,
  '--label','chat-codex.resource=environment','--label','chat-codex.owner='+config.owner_id,'--label','chat-codex.id='+id,
  '--init','-i','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
  '--pids-limit','128','--memory','512m','--memory-swap','512m','--cpus','1',
  '--user',config.docker.user,'--workdir','/workspace','--env','HOME=/tmp',
  '--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--log-driver','none',
  '--mount','type=bind,src='+project.path+',dst=/workspace',
  config.docker.image,'node','-e','setInterval(() => {}, 60000)'];
}
export class DockerEnvironmentProvider {
 constructor(registry){this.registry=registry;this.busy=new Set();this.blocked=new Set();}
 name(id){return 'chat-codex-env-'+cleanId(this.registry.config.owner_id+':'+id);}
 async inspect(entry,project){
  const name=this.name(entry.id);
  let obj;
  try {obj=JSON.parse(await runDocker(['inspect',name]));obj=obj[0];}
  catch(e){if(/No such (object|container)/i.test(String(e.stderr??e.message)))return null;throw e;}
  const labels=obj.Config?.Labels??{};
  const mounts=obj.Mounts??[];
  if(labels['chat-codex.owner']!==this.registry.config.owner_id||labels['chat-codex.id']!==entry.id||
     labels['chat-codex.resource']!=='environment'||!mounts.some(m=>m.Type==='bind'&&m.Source===project.path&&m.Destination==='/workspace'))
    throw Error('Docker resource ownership or project binding mismatch; refusing operation');
  const h=obj.HostConfig??{},c=obj.Config??{};
  const safe=h.NetworkMode==='none'&&h.ReadonlyRootfs===true&&h.Privileged!==true&&
   h.PidsLimit===128&&h.Memory===536870912&&h.MemorySwap===536870912&&h.NanoCpus===1000000000&&
   (h.CapDrop??[]).includes('ALL')&&(h.SecurityOpt??[]).includes('no-new-privileges')&&
   c.User===this.registry.config.docker.user&&c.Image===this.registry.config.docker.image&&
   mounts.length===1&&!JSON.stringify(mounts).includes('docker.sock');
  if(!safe)throw Error('Docker isolation configuration drift; refusing operation');
  return obj;
 }
 async status(entry,project){
  const obj=await this.inspect(entry,project);
  if(!obj)return {id:entry.id,provider:'docker',lifecycle:'absent',ready:false,project:entry.project};
  const state=obj.State?.Running?'running':obj.State?.Status==='created'?'created':'stopped';
  return {id:entry.id,provider:'docker',lifecycle:state,ready:state==='running',project:entry.project};
 }
 async create(entry,project){
  if(await this.inspect(entry,project))throw Error('Environment already provisioned');
  await runDocker(environmentContainerArgs(this.registry.config,project,entry.id,this.name(entry.id)));
  return this.status(entry,project);
 }
 async start(entry,project){
  const current=await this.status(entry,project);
  if(current.lifecycle==='absent')throw Error('Create the environment first');
  if(current.lifecycle!=='running')await runDocker(['start',this.name(entry.id)]);
  return this.status(entry,project);
 }
 async stop(entry,project){
  if(this.busy.has(entry.id))throw Error('Environment has an active execution; cancel the task first');
  const current=await this.status(entry,project);
  if(current.lifecycle==='absent')throw Error('Environment not provisioned');
  if(current.lifecycle==='running')await runDocker(['stop','-t','1',this.name(entry.id)],15000);
  return this.status(entry,project);
 }
 async delete(entry,project){
  const current=await this.status(entry,project);
  if(current.lifecycle==='absent')throw Error('Environment not provisioned');
  if(this.busy.has(entry.id))throw Error('Environment has an active execution');
  await runDocker(['rm','--force',this.name(entry.id)]);
  return {...await this.status(entry,project),project_data:'retained'};
 }
 async run(entry,project,job,{signal}={}){
  const id=entry.id,name=this.name(id);
  if(this.blocked.has(id))throw Error('Environment cleanup unconfirmed; operator reconciliation required');
  if(this.busy.has(id))throw Error('Another operation is running in this environment');
  if((await this.status(entry,project)).lifecycle!=='running')throw Error('Environment is not running');
  this.busy.add(id);
  const started=Date.now();let receipt;
  try{
   receipt=await new Promise((resolve,reject)=>{
    const child=spawn('docker',['exec','-i',name,'node','--input-type=module','-e',helper],{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',bytes=0,termination=null,killPromise=null,done=false;
    const shutdown=reason=>{
      if(termination||done)return;
      termination=reason;
      // Killing docker-exec client alone does not prove process termination inside Docker.
      killPromise=runDocker(['stop','-t','0',name],10000).catch(()=>{this.blocked.add(id);})
        .finally(()=>child.kill('SIGKILL'));
    };
    const onAbort=()=>shutdown('cancelled');
    if(signal?.aborted)shutdown('cancelled');else signal?.addEventListener('abort',onAbort,{once:true});
    const timer=setTimeout(()=>shutdown('timeout'),job.timeout_ms??15000);
    const collect=which=>chunk=>{
      const kept=chunk.subarray(0,Math.max(0,65536-bytes));bytes+=chunk.length;
      if(which==='stdout')stdout+=kept.toString();else stderr+=kept.toString();
      if(bytes>65536)shutdown('output_limit');
    };
    child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));
    child.on('error',e=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);reject(e);});
    child.on('close',async code=>{
      done=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
      if(killPromise)await killPromise;
      resolve({exit_code:termination?null:code,stdout,stderr,termination:termination??(code===null?'unknown':null),duration_ms:Date.now()-started});
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(job));
   });
   if(this.blocked.has(id))throw Error('Environment stop after bounded execution could not be confirmed');
   if(job.op!=='exec'){
    if(receipt.exit_code!==0||receipt.termination)throw Error('File operation failed: '+receipt.stderr.slice(0,500));
    receipt={...receipt,result:JSON.parse(receipt.stdout),stdout:''};
   }
   return receipt;
  }finally{
   this.busy.delete(id);
   await fs.appendFile(this.registry.privateDir+'/audit.jsonl',JSON.stringify({at:new Date().toISOString(),kind:'environment',id,op:job.op,exit_code:receipt?.exit_code??null,termination:receipt?.termination??null,blocked:this.blocked.has(id)})+'\n',{mode:0o600});
  }
 }
}
