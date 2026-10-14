import crypto from 'node:crypto';
import {desktopObserveSchema,desktopActSchema,desktopWaitSchema,DesktopError,DESKTOP_SNAPSHOT_TTL_MS,DESKTOP_IMAGE_LIMIT_BYTES,verifyDesktopDriver} from './contract.mjs';

const NOT_DISPATCHED=new Set([
 'stale_target','target_not_found','unsupported_action','out_of_bounds',
 'invalid_window','no_interactive_desktop','permission_denied'
]);
export class DesktopCore {
 constructor({grantForTarget,driverFactory,clock=()=>Date.now()}={}){
  if(typeof grantForTarget!=='function'||typeof driverFactory!=='function')
   throw new DesktopError('invalid_composition','Desktop Core requires trusted grant and driver factories');
  this.grantForTarget=grantForTarget;this.driverFactory=driverFactory;
  this.clock=clock;this.snapshots=new Map();this.drivers=new Map();
 }
 bindingFor(target){
  // The injected admission gate must fail closed for unregistered targets.
  // Core receives no transport credentials, workspace paths or MCP envelopes.
  const key=target.kind+':'+target.id;
  let option;
  try{option=this.grantForTarget(target);}
  catch(error){this.drivers.delete(key);throw error;}
  if(option?.enabled!==true){
   this.drivers.delete(key);
   throw new DesktopError('desktop_not_enabled','Desktop capability not enabled for registered target');
  }
  if(typeof option.driver!=='string'||!/^[a-z][a-z0-9-]{0,62}$/.test(option.driver)){
   this.drivers.delete(key);
   throw new DesktopError('invalid_grant','Grant requires an audited driver name');
  }
  const binding=option.binding_revision??null;
  if(binding!==null&&(typeof binding!=='string'||binding.length<1||binding.length>128)){
   this.drivers.delete(key);
   throw new DesktopError('invalid_grant','Binding revision must be a bounded opaque string');
  }
  const current=this.drivers.get(key);
  // A Provider updates binding_revision when it rebinds a remote Host, even if
  // the driver name remains unchanged. Old target-bound snapshots then fail.
  if(!current||current.name!==option.driver||current.binding!==binding){
   this.drivers.delete(key);
   this.drivers.set(key,{name:option.driver,binding,driver:verifyDesktopDriver(this.driverFactory(option.driver,{target,grant:option}))});
  }
  return this.drivers.get(key);
 }
 select(target){return this.bindingFor(target).driver;}
 assertBinding(target,binding){
  if(this.bindingFor(target)!==binding)
   throw new DesktopError('unknown_snapshot','Desktop target binding changed');
 }
 async status(target){
  try{
   const binding=this.bindingFor(target),status=await binding.driver.status();
   this.assertBinding(target,binding);
   return {...status,target};
  }
  catch(e){if(e.code==='desktop_not_enabled'||e.code==='driver_unavailable')return {target,driver:null,state:e.code,ready:false,capabilities:[]};throw e;}
 }
 async observe(input){
  const a=desktopObserveSchema.parse(input),binding=this.bindingFor(a.target),driver=binding.driver;
  const status=await driver.status();
  if(!status.ready)throw new DesktopError(status.state,'Desktop is not ready: '+status.state);
  this.assertBinding(a.target,binding);
  const observed=await driver.observe(a);
  this.assertBinding(a.target,binding);
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
   if(mimeType!=='image/png'||typeof data!=='string'||data.length>4*Math.ceil(DESKTOP_IMAGE_LIMIT_BYTES/3))
    throw new DesktopError('invalid_capture','Desktop image must be a bounded PNG');
   const bytes=Buffer.from(data,'base64');
   if(bytes.length>DESKTOP_IMAGE_LIMIT_BYTES||bytes.toString('base64')!==data||
    !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    throw new DesktopError('invalid_capture','Desktop image must contain canonical base64 PNG bytes');
  }
  if(this.snapshots.size>=64){
   for(const [id,item] of this.snapshots)if(item.expires_at<=this.clock())this.snapshots.delete(id);
   if(this.snapshots.size>=64)this.snapshots.delete(this.snapshots.keys().next().value);
  }
  const id=crypto.randomUUID(),expires=this.clock()+DESKTOP_SNAPSHOT_TTL_MS;
  this.snapshots.set(id,{target:a.target,binding,receipt:observed.receipt,
   session:status.session_id??status.session,expires_at:expires});
  return {target:a.target,snapshot_id:id,expires_at:new Date(expires).toISOString(),
   driver:observed.driver,window:observed.window,elements:observed.elements??[],
   ...(observed.image?{image:observed.image}:{})};
 }
 async act(input){
  const a=desktopActSchema.parse(input),binding=this.bindingFor(a.target),driver=binding.driver;
  const snap=this.snapshots.get(a.snapshot_id);
  if(!snap||snap.target.kind!==a.target.kind||snap.target.id!==a.target.id||snap.binding!==binding)
   throw new DesktopError('unknown_snapshot','Snapshot does not belong to this target');
  this.snapshots.delete(a.snapshot_id); // consume before any await; no mutation retry
  if(snap.expires_at<=this.clock())throw new DesktopError('stale_snapshot','Desktop snapshot expired');
  const status=await driver.status();
  if(!status.ready)throw new DesktopError(status.state,'Desktop no longer ready');
  if(snap.session!==undefined&&snap.session!==(status.session_id??status.session))
   throw new DesktopError('stale_session','Desktop session changed since observation');
  this.assertBinding(a.target,binding);
  if(snap.expires_at<=this.clock())throw new DesktopError('stale_snapshot','Desktop snapshot expired');
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
  const a=desktopWaitSchema.parse(input),binding=this.bindingFor(a.target),driver=binding.driver,end=this.clock()+a.timeout_ms;
  for(;;){
   this.assertBinding(a.target,binding);
   const status=await driver.status();
   if(!status.ready)throw new DesktopError(status.state,'Desktop became unavailable: '+status.state);
   if(this.clock()>=end)return {target:a.target,matched:false,termination:'timeout'};
   this.assertBinding(a.target,binding);
   const state=await driver.observe({mode:'windows'});
   this.assertBinding(a.target,binding);
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
