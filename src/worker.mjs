// Executed only INSIDE a fresh constrained container. Never imported by gateway.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
let input='';for await(const c of process.stdin)input+=c;
const job=JSON.parse(input);
async function resolve(p, missing=false) {
  if(typeof p!=='string'||p.includes('\0')||path.isAbsolute(p)||p.split('/').includes('..'))throw Error('Use a relative project path without ..');
  const absolute=path.resolve('/workspace',p);
  let real;
  try{real=await fs.realpath(absolute);}catch(e){
    if(!missing||e.code!=='ENOENT')throw e;
    real=path.join(await fs.realpath(path.dirname(absolute)),path.basename(absolute));
  }
  if(real!=='/workspace'&&!real.startsWith('/workspace/'))throw Error('Path leaves project');
  return real;
}
try {
  if(job.op==='exec') {
    const cwd=await resolve(job.cwd??'.');
    const c=spawn('/bin/sh',['-c',job.command],{cwd,stdio:['ignore','inherit','inherit'],env:{PATH:process.env.PATH,HOME:'/tmp',LANG:'C.UTF-8'}});
    c.on('error',e=>{console.error(e.message);process.exitCode=127;});
    c.on('close',(code,signal)=>{process.exitCode=code??(signal?128:1);});
  } else {
    const p=await resolve(job.path,job.op==='write');let result;
    if(job.op==='list') {const all=await fs.readdir(p,{withFileTypes:true});result={entries:all.slice(0,500).map(x=>({name:x.name,type:x.isSymbolicLink()?'symlink':x.isDirectory()?'directory':'file'})),truncated:all.length>500};}
    else if(job.op==='read') {const s=await fs.stat(p);if(s.size>32768)throw Error('File exceeds 32 KiB');result={content:await fs.readFile(p,'utf8')};}
    else if(job.op==='write') {await fs.writeFile(p,job.content,{mode:0o600});result={written:true};}
    else if(job.op==='edit') {
      const s=await fs.stat(p);if(s.size>32768)throw Error('File exceeds 32 KiB');
      const old=await fs.readFile(p,'utf8');if(!job.old_text||old.split(job.old_text).length!==2)throw Error('old_text must match exactly once');
      await fs.writeFile(p,old.replace(job.old_text,()=>job.new_text));result={edited:true};
    } else throw Error('Unknown operation');
    console.log(JSON.stringify(result));
  }
} catch(e) {console.error(e.message);process.exitCode=1;}
