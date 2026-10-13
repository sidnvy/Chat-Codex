import crypto from 'node:crypto';
import {resolveTarget} from '../resources.mjs';
import {desktopObserveSchema,desktopActSchema,desktopWaitSchema,DesktopError,DESKTOP_SNAPSHOT_TTL_MS,verifyDesktopDriver} from './contract.mjs';
import {createBuiltInDesktopCatalog} from './drivers.mjs';

export class DesktopManager {
 constructor(registry,{driverFactory,catalog=createBuiltInDesktopCatalog(),clock=()=>Date.now()}={}){
  this.registry=registry;this.clock=clock;this.snapshots=new Map();
  this.catalog=catalog;
  this.driverFactory=driverFactory??(name=>this.catalog.create(name));
  this.drivers=new Map();
 }
 select(target){
  // Registry admission is mandatory before any CLI or Desktop backend request.
  const resolved=resolveTarget(this.registry,target);
  const option=resolved.entry.capabilities?.desktop;
  if(!option?.enabled)throw new DesktopError('desktop_not_enabled','Desktop capability not enabled for registered target');
  const key=target.kind+':'+target.id;
  if(!this.drivers.has(key))this.drivers.set(key,verifyDesktopDriver(this.driverFactory(option.driver)));
  return this.drivers.get(key);
 }
 async status(target){
  resolveTarget(this.registry,target);
  try{return {target,...await this.select(target).status()};}
  catch(e){if(e.code==='desktop_not_enabled'||e.code==='driver_unavailable')return {target,driver:null,state:e.code,ready:false,capabilities:[]};throw e;}
 }
 async observe(input){
  const a=desktopObserveSchema.parse(input),driver=this.select(a.target);
  const s=await driver.status();
  if(!s.ready)throw new DesktopError(s.state,'Desktop is not ready: '+s.state);
  const observed=await driver.observe(a);
  if(a.mode==='windows')return {target:a.target,...observed};
  if(this.snapshots.size>=64){
   for(const [id,item] of this.snapshots)if(item.expires_at<=this.clock())this.snapshots.delete(id);
   if(this.snapshots.size>=64)this.snapshots.delete(this.snapshots.keys().next().value);
  }
  const id=crypto.randomUUID(),expires=this.clock()+DESKTOP_SNAPSHOT_TTL_MS;
  this.snapshots.set(id,{target:a.target,driver,receipt:observed.receipt,expires_at:expires});
  return {target:a.target,snapshot_id:id,expires_at:new Date(expires).toISOString(),
   driver:observed.driver,window:observed.window,elements:observed.elements??[],
   ...(observed.image?{image:observed.image}:{})};
 }
 async act(input){
  const a=desktopActSchema.parse(input),driver=this.select(a.target);
  const snap=this.snapshots.get(a.snapshot_id);
  if(!snap||snap.target.kind!==a.target.kind||snap.target.id!==a.target.id||snap.driver!==driver)
   throw new DesktopError('unknown_snapshot','Snapshot does not belong to this target');
  this.snapshots.delete(a.snapshot_id); // one-shot; never retry a mutation implicitly
  if(snap.expires_at<=this.clock())throw new DesktopError('stale_snapshot','Desktop snapshot expired');
  const status=await driver.status();
  if(!status.ready)throw new DesktopError(status.state,'Desktop no longer ready');
  const result=await driver.act(snap.receipt,a.action);
  return {target:a.target,snapshot_id:a.snapshot_id,...result};
 }
 async wait(input){
  const a=desktopWaitSchema.parse(input),driver=this.select(a.target),end=this.clock()+a.timeout_ms;
  for(;;){
   const s=await driver.status();
   if(!s.ready)throw new DesktopError(s.state,'Desktop became unavailable: '+s.state);
   const state=await driver.observe({mode:'windows'});
   const match=state.windows.find(w=>w.title===a.condition.title);
   if(match)return {target:a.target,matched:true,window:match};
   if(this.clock()>=end)return {target:a.target,matched:false,termination:'timeout'};
   await new Promise(r=>setTimeout(r,Math.min(250,Math.max(1,end-this.clock()))));
  }
 }
}
