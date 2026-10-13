import fs from 'node:fs/promises';
import path from 'node:path';

const segment=s=>encodeURIComponent(s);
const u=(kind,id)=>'chat-codex://'+kind+'/'+segment(id);
const link=(uri,name,description)=>({type:'resource_link',uri,name,description});
const sensitive=/^(?:node_modules|private|secrets?|credentials?|id_rsa|id_ed25519|authorized_keys|known_hosts|config\.json|token|tunnel-authorization)$/i;
const hidden=name=>name.startsWith('.')||sensitive.test(name)||/(?:^|[-_.])(secret|token|credential|private|api[-_]?key)(?:[-_.]|$)/i.test(name)||/\.(?:pem|key|p12|pfx|kdbx)$/i.test(name);
async function files(project,query,max=10){
 const result=[];let scanned=0,dirs=0,bytes=0;
 const walk=async(relative,depth)=>{
  if(result.length>=max||depth>2||scanned>=500||dirs>=32||bytes>=4096)return;
  dirs++;
  let entries=[];
  try{entries=await fs.readdir(path.join(project.path,relative),{withFileTypes:true});}catch{return;}
  for(const x of entries.slice(0,150)){
   if(result.length>=max||scanned++>=500||dirs>=32||bytes>=4096)break;
   if(hidden(x.name)||x.isSymbolicLink())continue;
   const rel=relative?relative+'/'+x.name:x.name;
   if(x.isFile()&&rel.toLowerCase().includes(query)){
    const item=link(u('project',project.id)+'/file/'+rel.split('/').map(segment).join('/'),rel,'Project file in '+project.id);
    const size=Buffer.byteLength(JSON.stringify(item));
    if(bytes+size<=4096){result.push(item);bytes+=size;}
   }
   if(x.isDirectory()&&depth<2)await walk(rel,depth+1);
  }
 };
 await walk('',0);
 return result;
}
export async function searchResources(registry,term){
 const q=term.normalize('NFKC').trim().toLocaleLowerCase('en-US').slice(0,80);
 const matches=(kind,id)=>!q||id.toLowerCase().includes(q)||kind.includes(q)||
  (kind==='environment'&&'sandbox docker disposable'.includes(q))||(kind==='host'&&'machine workstation'.includes(q));
 const out=[];
 for(const h of registry.hosts.values())if(matches('host',h.id))out.push(link(u('host',h.id),h.id,'Registered persistent Host (unsandboxed)'));
 for(const e of registry.environments.values())if(matches('environment',e.id))out.push(link(u('environment',e.id),e.id,'Provisioned disposable Environment'));
 for(const p of registry.projects.values())if(matches('project',p.id))out.push(link(u('project',p.id),p.id,'Project, independent of runtime lifecycle'));
 if(q.length>=2)for(const p of registry.projects.values()){
  if(out.length>=20)break;
  out.push(...await files(p,q,Math.min(10,20-out.length)));
 }
 let used=0;const items=[];
 for(const item of out){const size=Buffer.byteLength(JSON.stringify(item));if(used+size>8192)break;items.push(item);used+=size;}
 return {items:items.slice(0,20)};
}
