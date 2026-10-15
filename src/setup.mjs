import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

/** Create new, separate first-run data only. Never overwrite an installation. */
export async function createSetup({project,privateDir,backend='host',port=8791,ownerId=crypto.randomUUID(),
 platform=process.platform,uid=process.getuid?.(),gid=process.getgid?.(),command=execFileSync}={}){
 if(platform!=='linux'||!Number.isInteger(uid)||uid===0||!Number.isInteger(gid))throw Error('Setup requires a non-root Linux user.');
 if(!['docker','host','both'].includes(backend))throw Error('Choose docker, host or both.');
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Port must be between 1024 and 65535.');
 if(!project||!privateDir||!path.isAbsolute(project)||!path.isAbsolute(privateDir))throw Error('Use absolute paths for both new directories.');
 // Resolve existing parents before checking overlap, including symlink aliases.
 const canonical=async p=>path.join(await fs.realpath(path.dirname(path.resolve(p))),path.basename(path.resolve(p)));
 project=await canonical(project);privateDir=await canonical(privateDir);
 if(project===privateDir||project.startsWith(privateDir+path.sep)||privateDir.startsWith(project+path.sep)||project===path.parse(project).root)
  throw Error('Project and private configuration must be separate new directories.');
 for(const p of [project,privateDir]){
  try{await fs.lstat(p);throw Error('Setup requires new directories; existing data is never overwritten.');}
  catch(e){if(e.code!=='ENOENT')throw e;}
 }
 let image;
 if(backend!=='host'){
  let digests;
  try{digests=JSON.parse(command('docker',['image','inspect','node:22-bookworm-slim','--format','{{json .RepoDigests}}'],{encoding:'utf8',timeout:10000,maxBuffer:32768}));}
  catch{throw Error('Docker or its reviewed image is unavailable. Start Docker and run: docker pull node:22-bookworm-slim');}
  const digest=Array.isArray(digests)&&digests.find(x=>typeof x==='string'&&/^node@sha256:[a-f0-9]{64}$/.test(x));
  if(!digest)throw Error('Pull the reviewed official node:22-bookworm-slim image before setup.');
  image='node:22-bookworm-slim@'+digest.split('@')[1];
 }
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(ownerId))throw Error('Invalid installation identity');
 const config={version:2,owner_id:ownerId,port,
  projects:[{id:'default',path:project}],
  hosts:backend==='docker'?[]:[{id:'local',project:'default',enabled:true,connection:'local',unsandboxed:true}],
  environments:backend==='host'?[]:[{id:'dev',project:'default',provider:'docker'}],
  ...(image?{docker:{user:uid+':'+gid,image}}:{})};
 const directories=[],files=[];
 try{
  for(const p of [project,privateDir]){await fs.mkdir(p,{mode:0o700});directories.push(p);}
  const token=crypto.randomBytes(32).toString('base64url');
  for(const [name,content] of [['token',token+'\n'],['tunnel-authorization','Bearer '+token+'\n'],['config.json',JSON.stringify(config,null,2)+'\n']]){
   const p=path.join(privateDir,name);const handle=await fs.open(p,'wx',0o600);files.push(p);
   try{await handle.writeFile(content);}finally{await handle.close();}
  }
 }catch(error){
  for(const p of files.reverse())await fs.unlink(p).catch(()=>{});
  for(const p of directories.reverse())await fs.rmdir(p).catch(()=>{});
  throw error;
 }
 return {configFile:path.join(privateDir,'config.json'),project,privateDir,backend,port};
}
