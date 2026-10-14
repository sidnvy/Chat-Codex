import {resolveTarget,targetSchema,listProjects} from './resources.mjs';
import {HostRunner} from './host-runner.mjs';
import {createBuiltInEnvironmentCatalog} from './runtime/providers.mjs';
import {assertLifecycleReceipt} from './provider-contract.mjs';

export class TargetRouter {
 constructor(registry,{environmentCatalog=createBuiltInEnvironmentCatalog()}={}){
  this.registry=registry;
  this.providers=new Map();
  for(const entry of registry.environments.values()){
   if(!this.providers.has(entry.provider))this.providers.set(entry.provider,environmentCatalog.create(entry.provider,registry));
  }
  this.docker=this.providers.get('docker')??null;
  this.hosts=new Map();
  for(const h of registry.hosts.values()){
   this.hosts.set(h.id,new HostRunner({project:registry.projects.get(h.project).path,audit:registry.privateDir+'/audit.jsonl'}));
  }
 }
 resolve(target){return resolveTarget(this.registry,target);}
 hostCapabilities(h){return {exec:{enabled:true},filesystem:{enabled:true},desktop:{enabled:Boolean(h.capabilities?.desktop?.enabled),...(h.capabilities?.desktop?.driver?{driver:h.capabilities.desktop.driver}:{})}};}
 hostsList(){return [...this.registry.hosts.values()].map(h=>({id:h.id,project:h.project,connection:'connected',unsandboxed:true,capabilities:this.hostCapabilities(h)}));}
 projectsList(){return listProjects(this.registry);}
 async providerReceipt(entry,receipt){
  assertLifecycleReceipt(receipt);
  if(receipt.id!==entry.id||receipt.provider!==entry.provider)
   throw Error('Environment Provider receipt identity mismatch');
  return receipt;
 }
 async status(target){
  const {entry,project}=this.resolve(target);
  if(target.kind==='host')return {id:entry.id,kind:'host',connection:'connected',ready:true,unsandboxed:true,project:entry.project,capabilities:this.hostCapabilities(entry)};
  return {kind:'environment',...await this.providerReceipt(entry,await this.providers.get(entry.provider).status(entry,project))};
 }
 async environmentsList(){
  const result=[];
  for(const e of this.registry.environments.values())result.push(await this.status({kind:'environment',id:e.id}));
  return result;
 }
 async lifecycle(action,id){
  const {entry,project}=this.resolve({kind:'environment',id});
  if(!['create','start','stop','delete'].includes(action))throw Error('Invalid environment lifecycle action');
  return this.providerReceipt(entry,await this.providers.get(entry.provider)[action](entry,project));
 }
 async run(target,job,options={}){
  // Validation and registry admission always occur before any Host/Docker IO.
  const {entry,project}=this.resolve(target);
  if(target.kind==='host')return this.hosts.get(entry.id).run(job,options);
  return this.providers.get(entry.provider).run(entry,project,job,options);
 }
}
