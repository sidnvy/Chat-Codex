import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
const exec = promisify(execFile);
const helper = await fs.readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
export function containerArgs(config, name) {
  return ['create','--pull','never','--name',name,'--label','chat-codex=ephemeral','--init','-i',
    '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--pids-limit','128','--memory','512m','--memory-swap','512m','--cpus','1',
    '--user',config.user,'--workdir','/workspace','--env','HOME=/tmp',
    '--tmpfs','/tmp:rw,nosuid,nodev,size=64m', '--log-driver','none',
    '--mount',`type=bind,src=${config.project},dst=/workspace`,
    config.image,'node','--input-type=module','-e',helper];
}
export class Runner {
  constructor(config) { this.config=config; this.busy=false; this.blocked=false; }
  async run(job) {
    if(this.blocked) throw Error('Runner cleanup failed; restart only after checking its containers');
    if(this.busy) throw Error('Another operation is running; wait for its result');
    this.busy=true;
    const id='chat-codex-'+crypto.randomUUID();
    const started=Date.now();
    let receipt;
    try {
      await exec('docker',containerArgs(this.config,id),{timeout:15000,maxBuffer:65536});
      receipt=await new Promise((resolve,reject)=>{
        const child=spawn('docker',['start','--attach','--interactive',id],{stdio:['pipe','pipe','pipe']});
        let stdout='',stderr='',size=0,stopped=false,reason=null,stopTask;
        const stop=why=>{if(stopped)return;stopped=true;reason=why;stopTask=exec('docker',['kill',id],{timeout:5000}).catch(()=>{}).finally(()=>child.kill('SIGKILL'));};
        const timer=setTimeout(()=>stop('timeout'),job.timeout_ms??15000);
        const collect=which=>chunk=>{
          const remaining=Math.max(0,65536-size); const kept=chunk.subarray(0,remaining);size+=chunk.length;
          if(which==='out')stdout+=kept.toString();else stderr+=kept.toString();
          if(size>65536)stop('output_limit');
        };
        child.stdout.on('data',collect('out'));child.stderr.on('data',collect('err'));
        child.on('error',e=>{clearTimeout(timer);reject(e);});
        child.on('close',async code=>{clearTimeout(timer);await stopTask;resolve({exit_code:reason?null:code,stdout,stderr,termination:reason,duration_ms:Date.now()-started});});
        child.stdin.on('error',()=>{});
        child.stdin.end(JSON.stringify(job));
      });
      if(job.op!=='exec' && (receipt.exit_code!==0 || receipt.termination)) throw Error('File operation failed: '+receipt.stderr.slice(0,500));
      if(job.op!=='exec') receipt={...receipt,result:JSON.parse(receipt.stdout),stdout:''};
      return receipt;
    } finally {
      try {
        await exec('docker',['rm','--force',id],{timeout:10000,maxBuffer:65536});
      } catch(e) {
        if(!String(e.stderr).includes('No such container')) this.blocked=true;
      }
      this.busy=false;
      await fs.appendFile(this.config.audit,JSON.stringify({id,op:job.op,at:new Date().toISOString(),exit_code:receipt?.exit_code??null,termination:receipt?.termination??null,cleanup_failed:this.blocked})+'\n',{mode:0o600});
      if(this.blocked) throw Error('Container cleanup failed; runner locked. Inspect container '+id);
    }
  }
}
