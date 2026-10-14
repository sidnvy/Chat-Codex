import crypto from 'node:crypto';
import {resolveTarget} from '../resources.mjs';
import {desktopObserveSchema,desktopActSchema,desktopWaitSchema,DesktopError,DESKTOP_SNAPSHOT_TTL_MS,DESKTOP_IMAGE_LIMIT_BYTES,verifyDesktopDriver} from './contract.mjs';
import {createBuiltInDesktopCatalog} from './drivers.mjs';

const NOT_DISPATCHED=new Set([
 'stale_target','target_not_found','unsupported_action','out_of_bounds',
 'invalid_window','no_interactive_desktop','permission_denied'
]);
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
  const current=this.drivers.get(key);
  // Never retain an old driver after an administrator changes the grant.
  if(!current||current.name!==option.driver)
   this.drivers.set(key,{name:option.driver,driver:verifyDesktopDriver(this.driverFactory(option.driver))});
  return this.drivers.get(key).driver;
 }
 async status(target){
  resolveTarget(this.registry,target);
  try{return {...await this.select(target).status(),target};}
  catch(e){if(e.code==='desktop_not_enabled'||e.code==='driver_unavailable')return {target,driver:null,state:e.code,ready:false,capabilities:[]};throw e;}
 }
 async observe(input){
  const a=desktopObserveSchema.parse(input),driver=this.select(a.target);
  const status=await driver.status();
  if(!status.ready)throw new DesktopError(status.state,'Desktop is not ready: '+status.state);
  const observed=await driver.observe(a);
  if(a.mode==='windows'){
   if(!Array.isArray(observed?.windows))throw new DesktopError('invalid_driver_response','Window inventory is not an array');
   return {...observed,target:a.target};
  }
  if(observed?.window?.id!==a.window_id||!observed.receipt||typeof observed.receipt!=='object')
   throw new DesktopError('invalid_driver_response','Exact window identity or receipt is missing');
  const receiptIds=[observed.receipt.window_id,observed.receipt.hwnd].filter(x=>x!==undefined);
  if(!receiptIds.length||receiptIds.some(x=>{
   const id=typeof x==='string'?x:typeof x==='number'&&Number.isSafeInteger(x)?String(x):null;
   return id!==a.window_id;
  }))throw new DesktopError('invalid_driver_response','Receipt does not bind the requested window');
  if(observed.image){
   const {mimeType,data}=observed.image;
   if(mimeType!=='image/png'||typeof data!=='string'||Buffer.byteLength(data,'base64')>DESKTOP_IMAGE_LIMIT_BYTES)
    throw new DesktopError('invalid_capture','Desktop image must be a bounded PNG');
  }
  if(this.snapshots.size>=64){
   for(const [id,item] of this.snapshots)if(item.expires_at<=this.clock())this.snapshots.delete(id);
   if(this.snapshots.size>=64)this.snapshots.delete(this.snapshots.keys().next().value);
  }
  const id=crypto.randomUUID(),expires=this.clock()+DESKTOP_SNAPSHOT_TTL_MS;
  this.snapshots.set(id,{target:a.target,driver,receipt:observed.receipt,
   session:status.session_id??status.session,expires_at:expires});
  return {target:a.target,snapshot_id:id,expires_at:new Date(expires).toISOString(),
   driver:observed.driver,window:observed.window,elements:observed.elements??[],
   ...(observed.image?{image:observed.image}:{})};
 }
 async act(input){
  const a=desktopActSchema.parse(input),driver=this.select(a.target);
  const snap=this.snapshots.get(a.snapshot_id);
  if(!snap||snap.target.kind!==a.target.kind||snap.target.id!==a.target.id||snap.driver!==driver)
   throw new DesktopError('unknown_snapshot','Snapshot does not belong to this target');
  this.snapshots.delete(a.snapshot_id); // consume before any await; no mutation retry
  if(snap.expires_at<=this.clock())throw new DesktopError('stale_snapshot','Desktop snapshot expired');
  const status=await driver.status();
  if(!status.ready)throw new DesktopError(status.state,'Desktop no longer ready');
  if(snap.session!==undefined&&snap.session!==(status.session_id??status.session))
   throw new DesktopError('stale_session','Desktop session changed since observation');
  let result;
  try{result=await driver.act(snap.receipt,a.action);}
  catch(error){
   // Dispatch may already have happened; a transport/worker failure is ambiguous.
   if(NOT_DISPATCHED.has(error?.code))throw error;
   return {target:a.target,snapshot_id:a.snapshot_id,outcome:'outcome_unknown',verified:false};
  }
  if(!result||result.verified!==false||!['dispatched_unverified','outcome_unknown'].includes(result.outcome))
   return {target:a.target,snapshot_id:a.snapshot_id,outcome:'outcome_unknown',verified:false};
  return {...result,target:a.target,snapshot_id:a.snapshot_id};
 }
 async wait(input){
  const a=desktopWaitSchema.parse(input),driver=this.select(a.target),end=this.clock()+a.timeout_ms;
  for(;;){
   const status=await driver.status();
   if(!status.ready)throw new DesktopError(status.state,'Desktop became unavailable: '+status.state);
   if(this.clock()>=end)return {target:a.target,matched:false,termination:'timeout'};
   const state=await driver.observe({mode:'windows'});
   if(this.clock()>=end)return {target:a.target,matched:false,termination:'timeout'};
   if(!Array.isArray(state?.windows)||state.truncated===true)
    throw new DesktopError('incomplete_observation','Window inventory cannot prove an exact match');
   const match=state.windows.find(w=>w.title_truncated!==true&&w.title===a.condition.title);
   if(match)return {target:a.target,matched:true,window:match};
   if(this.clock()>=end)return {target:a.target,matched:false,termination:'timeout'};
   await new Promise(r=>setTimeout(r,Math.min(250,Math.max(1,end-this.clock()))));
  }
 }
}
