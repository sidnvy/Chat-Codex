import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {resolveTarget} from './resources.mjs';

export class TaskManager {
 constructor(router){this.router=router;this.file=path.join(router.registry.privateDir,'tasks.json');this.records=new Map();this.controllers=new Map();this.running=new Map();this.writeQueue=Promise.resolve();}
 async init(){
  let records=[];
  try{records=JSON.parse(await fs.readFile(this.file,'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(!Array.isArray(records))throw Error('Task receipt store corrupted');
  for(const record of records.slice(-100)){
   if(record.status==='running'){record.status='lost';record.finished_at=new Date().toISOString();record.error='Server restarted before completion confirmation';}
   this.records.set(record.id,record);
  }
  await this.persist();
  return this;
 }
 persist(){
  this.writeQueue=this.writeQueue.then(async()=>{
   const temp=this.file+'.'+crypto.randomBytes(6).toString('hex');
   await fs.writeFile(temp,JSON.stringify([...this.records.values()].slice(-100),null,2),{mode:0o600,flag:'wx'});
   await fs.rename(temp,this.file);
  });
  return this.writeQueue;
 }
 lookup(target,id){
  resolveTarget(this.router.registry,target);
  const r=this.records.get(id);
  if(!r||r.target.kind!==target.kind||r.target.id!==target.id)throw Error('Unknown task for target');
  return r;
 }
 view(r,maxLines=200){
  const cut=s=>String(s??'').split('\n').slice(0,maxLines).join('\n').slice(0,65536);
  return {...r,stdout:cut(r.stdout),stderr:cut(r.stderr)};
 }
 list(target,limit=10){
  resolveTarget(this.router.registry,target);
  return [...this.records.values()].filter(r=>r.target.kind===target.kind&&r.target.id===target.id).slice(-limit).reverse().map(r=>this.view(r,20));
 }
 async start(target,job){
  resolveTarget(this.router.registry,target);
  const id=crypto.randomBytes(12).toString('hex');
  const r={id,target,status:'running',command:job.command,started_at:new Date().toISOString(),exit_code:null,termination:null,stdout:'',stderr:''};
  this.records.set(id,r);
  while(this.records.size>100)this.records.delete(this.records.keys().next().value);
  const ctrl=new AbortController();this.controllers.set(id,ctrl);
  await this.persist();
  const running=(async()=>{
   try{
    const outcome=await this.router.run(target,job,{signal:ctrl.signal});
    Object.assign(r,outcome);
    r.status=outcome.termination==='cancelled'?'cancelled':
     outcome.termination==='unknown'?'unknown':
     outcome.exit_code===0&&!outcome.termination?'completed':'failed';
   }catch(e){
    r.status=ctrl.signal.aborted?'unknown':'failed';
    r.error=String(e.message).slice(0,500);
   }finally{
    r.finished_at=new Date().toISOString();
    this.controllers.delete(id);
    await this.persist();
    this.running.delete(id);
   }
  })();
  this.running.set(id,running);
  return this.view(r);
 }
 poll(target,id,maxLines=200){return this.view(this.lookup(target,id),maxLines);}
 async stop(target,id){
  const record=this.lookup(target,id);
  if(record.status!=='running')return this.view(record);
  const ctrl=this.controllers.get(id);
  if(!ctrl){record.status='lost';record.error='No in-process task controller';await this.persist();return this.view(record);}
  ctrl.abort();
  const active=this.running.get(id);
  if(active)await Promise.race([active,new Promise(resolve=>setTimeout(resolve,12000))]);
  if(record.status==='running'){record.status='unknown';record.error='Cancellation unconfirmed';await this.persist();}
  return this.view(record);
 }
}
