// Executed with the existing non-root identity of the selected Host or Environment.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>131072)throw Error('Job too large');}
const job=JSON.parse(input);
const root=await fs.realpath(process.env.CHAT_CODEX_PROJECT||'/workspace');
async function resolve(p,mayCreate=false){
 if(typeof p!=='string'||!p||p.includes('\0')||path.isAbsolute(p)||p.split('/').includes('..'))throw Error('Use a relative project path without ..');
 const absolute=path.resolve(root,p);
 let real;
 try{real=await fs.realpath(absolute);}
 catch(e){
  if(!mayCreate||e.code!=='ENOENT')throw e;
  real=path.join(await fs.realpath(path.dirname(absolute)),path.basename(absolute));
 }
 if(real!==root&&!real.startsWith(root+path.sep))throw Error('Path leaves project');
 return real;
}
function parseUnifiedPatch(patch,requested){
 const lines=patch.replace(/\r\n/g,'\n').split('\n');
 const header=lines.findIndex(s=>s.startsWith('--- '));
 if(header<0||!lines[header+1]?.startsWith('+++ '))throw Error('Unified diff headers required');
 const old=lines[header].slice(4).split('\t')[0].replace(/^a\//,'');
 const next=lines[header+1].slice(4).split('\t')[0].replace(/^b\//,'');
 if(old!==requested||next!==requested)throw Error('Patch headers must match requested existing file');
 if(lines.slice(header+2).some(l=>l.startsWith('--- ')||l.startsWith('+++ ')||l.startsWith('diff --git')))throw Error('Only single-file patches supported');
 const hunks=[];let i=header+2;
 while(i<lines.length){
  if(lines[i]===''){i++;continue;}
  const h=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i++]);
  if(!h)throw Error('Invalid unified diff hunk');
  const changes=[];
  while(i<lines.length&&!lines[i].startsWith('@@ ')){
   const v=lines[i++];
   if(v==='\\ No newline at end of file'||v==='')continue;
   if(![' ','+','-'].includes(v[0]))throw Error('Invalid unified diff line');
   changes.push(v);
  }
  const before=changes.filter(x=>x[0]!==' +'.trim()).filter(x=>x[0]!=='+').length;
  const after=changes.filter(x=>x[0]!=='-').length;
  if(before!==Number(h[2]??1)||after!==Number(h[4]??1))throw Error('Unified diff hunk counts mismatch');
  hunks.push({start:Number(h[1])-1,changes});
 }
 if(!hunks.length)throw Error('Empty patch');
 return hunks;
}
async function applyPatch(file,patch,relative){
 const st=await fs.stat(file);
 if(!st.isFile()||st.size>32768)throw Error('Patch target must be a file up to 32 KiB');
 const original=await fs.readFile(file,'utf8');
 if(!original.endsWith('\n'))throw Error('Patch currently requires a final newline');
 const hunks=parseUnifiedPatch(patch,relative);
 const source=original.slice(0,-1).split('\n'),output=[];let offset=0;
 for(const h of hunks){
  if(h.start<offset||h.start>source.length)throw Error('Out-of-order patch hunk');
  output.push(...source.slice(offset,h.start));offset=h.start;
  for(const line of h.changes){
   const kind=line[0],value=line.slice(1);
   if(kind!=='+' ){
    if(source[offset]!==value)throw Error('Patch context mismatch at line '+(offset+1));
    offset++;
   }
   if(kind!=='-')output.push(value);
  }
 }
 output.push(...source.slice(offset));
 const updated=output.join('\n')+'\n';
 if(Buffer.byteLength(updated)>32768)throw Error('Patched file exceeds 32 KiB');
 await fs.writeFile(file,updated,{flag:'w'});
 return {patched:true};
}
try {
 let result;
 if(job.op==='exec'){
  const cwd=await resolve(job.cwd??'.');
  const cmd=spawn('/bin/sh',['-c',job.command],{cwd,stdio:['ignore','inherit','inherit'],
   env:{PATH:process.env.PATH,HOME:process.env.HOME||'/tmp',LANG:'C.UTF-8'}});
  cmd.on('error',e=>{console.error(e.message);process.exitCode=127;});
  cmd.on('close',(code,signal)=>{process.exitCode=code??(signal?128:1);});
 }else{
  const p=await resolve(job.path,job.op==='write');
  if(job.op==='list'){
   const st=await fs.stat(p);if(!st.isDirectory())throw Error('Not a directory');
   const all=await fs.readdir(p,{withFileTypes:true});
   result={entries:all.slice(0,200).map(x=>({name:x.name,type:x.isSymbolicLink()?'symlink':x.isDirectory()?'directory':'file'})),truncated:all.length>200};
  }else if(job.op==='read'){
   const st=await fs.stat(p);if(!st.isFile()||st.size>32768)throw Error('File exceeds 32 KiB or is not regular');
   result={content:await fs.readFile(p,'utf8')};
  }else if(job.op==='write'){
   if(Buffer.byteLength(job.content)>32768)throw Error('Content too large');
   await fs.writeFile(p,job.content,{mode:0o600});result={written:true};
  }else if(job.op==='patch'){
   result=await applyPatch(p,job.patch,job.path);
  }else throw Error('Unknown operation');
  console.log(JSON.stringify(result));
 }
}catch(e){console.error(e.message);process.exitCode=1;}
