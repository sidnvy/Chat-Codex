import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DesktopError,DESKTOP_IMAGE_LIMIT_BYTES} from './contract.mjs';
import {localDesktopExec,parseCommandJson} from './exec.mjs';
const bounded=value=>String(value??'').slice(0,128);
const invalid=message=>new DesktopError('invalid_driver_response',message);
const decimal=value=>typeof value==='string'&&/^[1-9][0-9]*$/.test(value);
// Pinned Peekaboo DesktopActionOutcome.Projection; never infer dispatch from success alone.
function acceptedDispatch(outcome){
 const mechanisms=['composite','accessibility_action','accessibility_value','process_targeted_events','window_targeted_events','native_framework'];
 if(!outcome||!['local','bridge'].includes(outcome.route)||!mechanisms.includes(outcome.delivery_mechanism)||
  (outcome.dispatched_unit_count!=null&&(!Number.isSafeInteger(outcome.dispatched_unit_count)||outcome.dispatched_unit_count<=0))||
  outcome.dispatch_state!=='dispatched'||outcome.mutation_dispatched!==true||outcome.delivery_mode!=='background'||
  outcome.retry_safe!==false||outcome.refusal_reason!=null)return false;
 if(outcome.state==='confirmed_change')return outcome.effect==='confirmed'&&outcome.evidence==='verified_change'&&
  outcome.retry_safety==='not_applicable'&&outcome.escalation==='none'&&outcome.requires_fresh_observation===false;
 return outcome.state==='dispatched_unverified'&&outcome.effect==='unverifiable'&&
  ['delivery_accepted','operation_still_running'].includes(outcome.evidence)&&outcome.retry_safety==='unsafe'&&
  outcome.escalation==='observe_before_retry'&&outcome.requires_fresh_observation===true;
}
export class PeekabooDesktop {
 #locators=new Map();
 #locatorSession;
 constructor(run=localDesktopExec,sessionProbe=async()=>null,clock=()=>Date.now()){this.run=run;this.sessionProbe=sessionProbe;this.clock=clock;this.driver='peekaboo';}
 async call(args,{envelope=false}={}){
  const result=parseCommandJson(await this.run('peekaboo',[...args,'--json']),this.driver);
  if(result.success!==true)throw new DesktopError(result.error?.code??'driver_error',String(result.error?.message??'Peekaboo operation failed').slice(0,350));
  return envelope?result:result.data??{};
 }
 async status(){
  try{
   const data=await this.call(['permissions','status']);
   const permissions=Object.fromEntries((data.permissions??[]).map(p=>[p.name,p.isGranted===true]));
   if(permissions['Screen Recording']!==true||permissions.Accessibility!==true)
    return {driver:this.driver,state:'permission_denied',ready:false,permissions,capabilities:[]};
   const session=await this.sessionProbe();
   const verified=session?.ready===true&&typeof session.session_id==='string'&&session.session_id.length>0&&session.session_id.length<=1024;
   const state=verified?'ready':'session_unverified';
   return {driver:this.driver,state,ready:state==='ready',permissions,
    ...(verified?{session_id:createHash('sha256').update(session.session_id).digest('hex')}:{}),
    capabilities:state==='ready'?['windows','window_screenshot','accessibility','keyboard','element_click']:[]};
  }catch(e){return {driver:this.driver,state:e.code==='driver_unavailable'?'driver_unavailable':'session_unverified',ready:false,capabilities:[],error:String(e.message).slice(0,200)};}
 }
 async ready(session_id){
  const status=await this.status();
  if(!status.ready){this.#locators.clear();this.#locatorSession=undefined;throw new DesktopError(status.state,'Desktop session is not ready');}
  if(this.#locatorSession!==status.session_id){this.#locators.clear();this.#locatorSession=status.session_id;}
  if(session_id&&status.session_id!==session_id)throw new DesktopError('stale_target','Desktop session changed');
  return status.session_id;
 }
 async applications(){
  const data=await this.call(['app','list','--include-hidden','--include-background']);
  if(!Array.isArray(data.apps)||data.apps.some(a=>!Number.isSafeInteger(a.pid)||a.pid<=0))throw invalid('Invalid application inventory');
  return data;
 }
 async windows(app){
  const data=await this.call(['window','list','--pid',String(app.pid)]);
  if(data.target_application_info?.pid!==app.pid||!Array.isArray(data.windows))throw invalid('Window inventory owner does not match requested PID');
  const windows=data.windows.map(w=>{
   if(!Number.isSafeInteger(w.window_id)||w.window_id<=0||typeof w.window_title!=='string')throw invalid('Invalid exact window identity');
   return {id:String(w.window_id),title:bounded(w.window_title),title_truncated:w.window_title.length>128,app:bounded(app.name),pid:app.pid,
    full_title:w.window_title,process_start:app.process_start_identity_decimal};
  });
  return {windows,truncated:data.inventory_completeness!=='complete'};
 }
 async inventory(){
  const data=await this.applications();
  let truncated=data.apps.length>50||(data.warnings?.length??0)>0;
  const windows=[];
  for(const app of data.apps.slice(0,50)){
   try{const result=await this.windows(app);windows.push(...result.windows);truncated ||= result.truncated;}
   catch{truncated=true;}
   if(windows.length>100){truncated=true;break;}
  }
  const counts=new Map();
  for(const window of windows)counts.set(window.id,(counts.get(window.id)??0)+1);
  return {windows:windows.slice(0,100),truncated,duplicate_ids:new Set([...counts].filter(([,count])=>count>1).map(([id])=>id))};
 }
 async assertReceipt(receipt){
  await this.ready(receipt.session_id);
  const data=await this.applications();
  const app=data.apps.find(a=>a.pid===receipt.pid);
  if(!app||!decimal(receipt.process_start)||app.process_start_identity_decimal!==receipt.process_start)
   throw new DesktopError('stale_target','Window process changed since observation');
  const {windows}=await this.windows(app);
  const matches=windows.filter(w=>w.id===receipt.window_id);
  const window=matches.length===1?matches[0]:undefined;
  if(!window||window.full_title!==receipt.title)throw new DesktopError('stale_target','Window identity or title changed since observation');
  await this.ready(receipt.session_id);
  const age=this.clock()-receipt.observed_at;
  if(!Number.isFinite(receipt.observed_at)||age<0||age>=30000)throw new DesktopError('stale_target','Capture expired during target validation');
  return window;
 }
 async observe({mode,window_id}){
  const session_id=await this.ready();
  if(mode!=='windows'&&!decimal(window_id))throw new DesktopError('invalid_argument','An exact numeric window ID is required');
  const publicWindow=({full_title,process_start,...window})=>window;
  let locator=mode==='windows'?undefined:this.#locators.get(window_id);
  if(!locator){
   const inventory=await this.inventory();
   await this.ready(session_id);
   this.#locators.clear();
   for(const window of inventory.windows){
    if(!inventory.duplicate_ids.has(window.id))this.#locators.set(window.id,{
     id:window.id,pid:window.pid,full_title:window.full_title,process_start:window.process_start,session_id
    });
   }
   if(mode==='windows')return {driver:this.driver,windows:inventory.windows.map(publicWindow),truncated:inventory.truncated};
   locator=this.#locators.get(window_id);
  }
  if(!locator||locator.session_id!==session_id)throw new DesktopError('target_not_found','Exact window not found uniquely in bounded inventory');
  const receipt={window_id,pid:locator.pid,title:locator.full_title,process_start:locator.process_start,session_id,observed_at:this.clock()};
  // A locator only chooses which PID to query. Every capture still validates live state.
  const window=await this.assertReceipt(receipt);
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'styx-peekaboo-'));
  try{
   const dest=path.join(tmp,'capture.png');
   const data=await this.call(['see','--pid',String(window.pid),'--window-id',window_id,'--mode','window','--path',dest,'--format','png','--depth','3','--max-elements','100']);
   if(typeof data.snapshot_id!=='string'||!data.snapshot_id||data.snapshot_id==='latest'||data.snapshot_reusable!==true||data.mutation_targeting_available!==true||data.semantic_scope!=='exact_or_requested'||data.capture_mode!=='window'||String(data.observation?.target?.window_id)!==window_id||data.window_title!==receipt.title)
    throw invalid('Capture is not bound to the requested exact window');
   if(!Array.isArray(data.ui_elements))throw invalid('Capture elements are missing');
   const seen=new Set();
   const elements=data.ui_elements.slice(0,100).map(e=>{
    if(typeof e.id!=='string'||!e.id||e.id.length>128||seen.has(e.id))throw invalid('Invalid or duplicate element identity');
    seen.add(e.id);return {id:e.id,role:String(e.role??'').slice(0,80),label:String(e.label??e.title??'').slice(0,160)};
   });
   let image;
   if(data.screenshot_raw!==''){
    if(data.coordinate_context?.window?.window_id!==Number(window_id)||data.coordinate_context?.window?.title!==receipt.title)throw new DesktopError('invalid_capture','Screenshot identity does not match the requested window');
    if(data.screenshot_raw!==dest)throw new DesktopError('invalid_capture','Capture path does not match the task-owned destination');
    const handle=await fs.open(dest,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
     const stat=await handle.stat();
     if(!stat.isFile()||stat.nlink!==1||stat.size<8||stat.size>DESKTOP_IMAGE_LIMIT_BYTES)throw new DesktopError('invalid_capture','Invalid or oversized capture');
     const bytes=Buffer.alloc(stat.size+1);
     const {bytesRead}=await handle.read(bytes,0,bytes.length,0);
     if(bytesRead!==stat.size||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new DesktopError('invalid_capture','Invalid capture bytes');
     image={mimeType:'image/png',data:bytes.subarray(0,bytesRead).toString('base64')};
    }finally{await handle.close();}
   }
   const currentWindow=await this.assertReceipt(receipt);
   return {driver:this.driver,window:publicWindow(currentWindow),elements,receipt:{...receipt,snapshot_id:data.snapshot_id,element_ids:elements.map(e=>e.id)},...(image?{image}:{})};
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
 }
 async act(receipt,action){
  let args;
  if(typeof receipt?.snapshot_id!=='string'||!receipt.snapshot_id||receipt.snapshot_id==='latest')throw invalid('A named capture snapshot is required');
  if(action.type==='type')args=['type','--text',action.text,'--accept-dispatched'];
  else if(action.type==='key')args=['press',action.key];
  else if(action.type==='invoke'){
   if(!receipt.element_ids?.includes(action.element_id))throw new DesktopError('invalid_element','Element was not exposed by this capture');
   args=['click','--on',action.element_id];
  }else throw new DesktopError('unsupported_action','Peekaboo supports type, key and observed element click');
  await this.assertReceipt(receipt);
  // Once the driver is entered, even a failure can follow partial input. Never retry automatically.
  try{
   const result=await this.call([...args,'--snapshot',receipt.snapshot_id,'--pid',String(receipt.pid),'--window-id',receipt.window_id],{envelope:true});
   if(!acceptedDispatch(result.outcome))return {driver:this.driver,outcome:'outcome_unknown',verified:false};
  }
  catch{return {driver:this.driver,outcome:'outcome_unknown',verified:false};}
  return {driver:this.driver,outcome:'dispatched_unverified',verified:false};
 }
}
