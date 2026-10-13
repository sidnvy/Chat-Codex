import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Process-group cleanup is lifecycle management, NOT security isolation.
// A program that deliberately creates a new session can escape this group.
export class HostRunner {
  constructor(config) {this.config=config;this.busy=false;this.blocked=false;}
  async run(job,{signal}={}) {
    if(this.blocked)throw Error('Host cleanup failed; inspect processes before restarting');
    if(this.busy)throw Error('Another operation is running; wait for its result');
    this.busy=true;
    const id='chat-codex-host-'+crypto.randomUUID(),started=Date.now();
    let temporary,receipt;
    try {
      temporary=await fs.mkdtemp(path.join(os.tmpdir(),id+'-'));
      receipt=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[fileURLToPath(new URL('./worker.mjs',import.meta.url))],{
          cwd:this.config.project,detached:true,stdio:['pipe','pipe','pipe'],
          env:{PATH:[path.dirname(process.execPath),'/usr/bin','/bin'].join(':'),HOME:temporary,TMPDIR:temporary,LANG:'C.UTF-8',CHAT_CODEX_PROJECT:this.config.project},
        });
        let stdout='',stderr='',size=0,reason=null;
        const killGroup=()=>{
          if(!child.pid)return;
          try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')this.blocked=true;}
        };
        const stop=why=>{reason??=why;killGroup();child.stdout.destroy();child.stderr.destroy();};
        const onAbort=()=>stop('cancelled');
        if(signal?.aborted)onAbort();else signal?.addEventListener('abort',onAbort,{once:true});
        const timer=setTimeout(()=>stop('timeout'),job.timeout_ms??15000);
        const collect=which=>chunk=>{
          const kept=chunk.subarray(0,Math.max(0,65536-size));size+=chunk.length;
          if(which==='out')stdout+=kept.toString();else stderr+=kept.toString();
          if(size>65536)stop('output_limit');
        };
        child.stdout.on('data',collect('out'));child.stderr.on('data',collect('err'));
        child.on('error',e=>{clearTimeout(timer);killGroup();reject(e);});
        // Do not wait for inherited stdout held open by a background descendant.
        child.on('exit',killGroup);
        child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);resolve({exit_code:reason?null:code,stdout,stderr,termination:reason,duration_ms:Date.now()-started});});
        child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(job));
      });
      if(job.op!=='exec'&&(receipt.exit_code!==0||receipt.termination))throw Error('File operation failed: '+receipt.stderr.slice(0,500));
      if(job.op!=='exec')receipt={...receipt,result:JSON.parse(receipt.stdout),stdout:''};
      return receipt;
    } finally {
      if(temporary)try{await fs.rm(temporary,{recursive:true,force:true});}catch{this.blocked=true;}
      this.busy=false;
      await fs.appendFile(this.config.audit,JSON.stringify({id,backend:'host',op:job.op,at:new Date().toISOString(),exit_code:receipt?.exit_code??null,termination:receipt?.termination??null,cleanup_failed:this.blocked})+'\n',{mode:0o600});
      if(this.blocked)throw Error('Host cleanup failed; runner locked. Inspect operation '+id);
    }
  }
}
