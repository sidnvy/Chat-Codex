import {DesktopError} from './contract.mjs';
import {localDesktopExec,parseCommandJson} from './exec.mjs';

const PID=/^[1-9][0-9]{0,9}$/;
function processId(value){
 const id=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;
 return typeof id==='string'&&PID.test(id)&&Number(id)<=4294967295?id:null;
}
const CANONICAL=/^(?:btn|txt|chk|cmb|itm|tab|img|lbl|pn|win|grp|lnk|mnu|mnb|lst|tre|tri|grd|dat|rdo|sld|prg|scr|tlb|stb|ttl|spl|sep|doc|hdr|hdi|tip|thm|tbl|elm)(?:-[a-z0-9]{1,15})?-[a-f0-9]{4}$/;
const HWND=/^[1-9][0-9]{0,19}$/;
function handle(value){
 const id=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;
 return typeof id==='string'&&HWND.test(id)?id:null;
}
function windowArray(data){
 const items=Array.isArray(data)?data:data?.windows??data?.results;
 if(!Array.isArray(items))throw new DesktopError('invalid_driver_response','WinApp list-windows must return an array');
 return items;
}
function projectWindow(w){
 const hwnd=handle(w?.hwnd??w?.HWND);
 if(!hwnd)return null; // A title or PID is never an exact-window identity.
 return {id:hwnd,hwnd,title:String(w.title??'').slice(0,128),title_truncated:String(w.title??'').length>128,
  app:String(w.app??w.processName??w.process_name??'').slice(0,128),
  ...(processId(w.pid??w.processId)?{pid:processId(w.pid??w.processId)}:{})};
}
function unwrapElements(data,selected){
 const hwnd=selected.hwnd;
 const checkPid=window=>{
  const supplied=window?.pid??window?.processId;
  if(supplied!==undefined&&processId(supplied)!==selected.pid)
   throw new DesktopError('stale_target','WinApp inspect process does not match selected HWND owner');
 };
 const windows=data?.windows;
 if(Array.isArray(windows)){
  const found=windows.find(w=>handle(w?.hwnd??w?.HWND)===hwnd);
  if(!found){
   // Some WinApp inspect responses omit hwnd for a single explicitly scoped -w target.
   if(windows.length!==1||windows[0]?.hwnd!==undefined||windows[0]?.HWND!==undefined)throw new DesktopError('stale_target','WinApp inspect window no longer matches selected HWND');
   checkPid(windows[0]);
   return Array.isArray(windows[0]?.elements)?windows[0].elements:[];
  }
  checkPid(found);
  return Array.isArray(found.elements)?found.elements:[];
 }
 if(Array.isArray(data?.elements)){
  if((data.hwnd!==undefined||data.HWND!==undefined)&&handle(data.hwnd??data.HWND)!==hwnd)
   throw new DesktopError('stale_target','WinApp inspect window does not match selected HWND');
  checkPid(data);return data.elements;
 } // older response compatibility
 throw new DesktopError('invalid_driver_response','WinApp inspect returned no recognized elements envelope');
}
function flattenElements(roots){
 if(roots.length>1000)throw new DesktopError('invalid_driver_response','WinApp element tree exceeds inspection bounds');
 const pending=roots.map(element=>({element,depth:0})).reverse(),elements=[],promoted=[],ids=new Set();
 let visited=0;
 while(pending.length){
  const {element:e,depth}=pending.pop();
  if(++visited>1000||depth>32)throw new DesktopError('invalid_driver_response','WinApp element tree exceeds inspection bounds');
  const id=String(e?.selector??e?.id??e?.elementId??e?.automationId??e?.slug??'');
  if(id&&id.length<=128){
   if(ids.has(id))throw new DesktopError('invalid_driver_response','Duplicate WinApp element selector');
   ids.add(id);
   if(elements.length<100){
    elements.push({id,role:String(e.role??e.type??e.controlType??'').slice(0,80),label:String(e.name??e.label??'').slice(0,160)});
    if(typeof e.automationId==='string'&&e.selector===e.automationId){
     if(typeof e.type!=='string'||!e.type||e.type.length>80||(e.name!=null&&(typeof e.name!=='string'||e.name.length>4096)))
      throw new DesktopError('invalid_driver_response','Promoted selector lacks bounded exact identity');
     promoted.push({id,automation_id:e.automationId,type:e.type,name:e.name??null});
    }
   }
  }
  if(e?.children!==undefined){
   if(!Array.isArray(e.children))throw new DesktopError('invalid_driver_response','Malformed WinApp element children');
   if(pending.length+e.children.length>1000)throw new DesktopError('invalid_driver_response','WinApp element tree exceeds inspection bounds');
   for(let i=e.children.length-1;i>=0;i--)pending.push({element:e.children[i],depth:depth+1});
  }
 }
 return {elements,promoted};
}
export class WinappDesktop {
 constructor(run=localDesktopExec,sessionProbe=async()=>false){
  this.run=run;this.sessionProbe=sessionProbe;this.driver='winapp';
 }
 async call(args){
  const payload=parseCommandJson(await this.run('winapp',['ui',...args,'--json']),this.driver);
  if(payload?.success===false||payload?.error)throw new DesktopError(payload.error?.code??'driver_error',String(payload.error?.message??'winapp ui operation failed').slice(0,350));
  return payload?.data??payload;
 }
 async listWindows(){
  const raw=windowArray(await this.call(['list-windows']));
  const windows=raw.map(projectWindow).filter(Boolean);
  return {windows,truncated:raw.length>100};
 }
 async session(){
  const proof=await this.sessionProbe();
  if(proof?.ready!==true||typeof proof.session_id!=='string'||!proof.session_id||proof.session_id.length>128)
   throw new DesktopError('no_interactive_desktop','Interactive desktop and session identity have not been verified');
  return proof.session_id;
 }
 async status(){
  try{
   const session=await this.session();
   const {windows}=await this.listWindows();
   if(await this.session()!==session)throw new DesktopError('stale_session','Windows interactive session changed');
   return {driver:this.driver,state:'ready',ready:true,session_id:session,
    inspection_available:true,window_count:windows.length,
    capabilities:['windows','accessibility','element_invoke','set_value']};
  }catch(e){return {driver:this.driver,state:e.code==='driver_unavailable'?'driver_unavailable':'session_unverified',ready:false,capabilities:[],error:e.message};}
 }
 async exactWindow(id){
  const hwnd=handle(id);
  if(!hwnd)throw new DesktopError('invalid_window','A discovered numeric HWND is required; app names and titles are not exact window targets');
  const {windows}=await this.listWindows();
  const selected=windows.find(w=>w.hwnd===hwnd);
  if(!selected)throw new DesktopError('target_not_found','Selected HWND is no longer present');
  if(!selected.pid)throw new DesktopError('invalid_window','Selected HWND has no valid process identity');
  if(windows.filter(w=>w.hwnd===hwnd).length!==1)throw new DesktopError('invalid_driver_response','Duplicate HWND identity');
  return selected;
 }
 async observe({mode,window_id}){
  if(mode==='windows'){
   const {windows,truncated}=await this.listWindows();
   return {driver:this.driver,windows:windows.slice(0,100),truncated};
  }
  const session=await this.session();
  const selected=await this.exactWindow(window_id);
  const data=await this.call(['inspect','-w',selected.hwnd,'--interactive']);
  const {elements,promoted}=flattenElements(unwrapElements(data,selected));
  const current=await this.exactWindow(window_id);
  if(current.pid!==selected.pid)throw new DesktopError('stale_target','HWND was reused during observation');
  if(await this.session()!==session)throw new DesktopError('stale_session','Windows interactive session changed');
  return {driver:this.driver,window:selected,elements,
   receipt:{hwnd:selected.hwnd,pid:selected.pid,session_id:session,element_ids:elements.map(e=>e.id),promoted_elements:promoted,observed_at:Date.now()}};
 }
 async act(receipt,action){
  const session=await this.session();
  const fresh=()=>receipt&&handle(receipt.hwnd)&&processId(receipt.pid)&&
   Number.isFinite(receipt.observed_at)&&Date.now()-receipt.observed_at<30000&&Date.now()>=receipt.observed_at;
  if(!fresh())throw new DesktopError('stale_target','Windows UIA observation is stale or invalid');
  if(receipt.session_id!==session)throw new DesktopError('stale_session','Windows interactive session changed');
  if(!['invoke','set_value'].includes(action.type))throw new DesktopError('unsupported_action','Windows adapter exposes only UIA invoke/set-value');
  if(!Array.isArray(receipt.element_ids)||!receipt.element_ids.includes(action.element_id))
   throw new DesktopError('stale_target','Element was not in the exact-window observation');
  const current=await this.exactWindow(receipt.hwnd);
  if(receipt.pid!==current.pid)throw new DesktopError('stale_target','HWND was reused by another process');
  let selector=action.element_id;
  const promoted=receipt.promoted_elements?.find(e=>e.id===selector);
  if(promoted){
   // --type selects upstream's constrained query path, which retains runtime-ID
   // slugs; ordinary search promotes AutomationIds again and cannot resolve this.
   const search=await this.call(['search',selector,'-w',receipt.hwnd,'--type',promoted.type,'--max-results','2']);
   const match=search?.matches?.[0];
   if(search?.matchCount!==1||search?.hasMore!==false||!Array.isArray(search.matches)||search.matches.length!==1||
    match?.automationId!==promoted.automation_id||match?.type!==promoted.type||(match?.name??null)!==promoted.name||
    typeof match?.selector!=='string'||!CANONICAL.test(match.selector)||
    (match.hwnd!==undefined&&handle(match.hwnd)!==receipt.hwnd)||
    (match.windowHandle!==undefined&&handle(match.windowHandle)!==receipt.hwnd))
    throw new DesktopError('stale_target','Promoted selector no longer has one exact canonical identity');
   selector=match.selector;
   // Search JSON intentionally scrubs windowHandle; exact -w scope plus a fresh
   // HWND/PID check supplies the window binding, never a title or app fallback.
   const after=await this.exactWindow(receipt.hwnd);
   if(after.pid!==receipt.pid)throw new DesktopError('stale_target','HWND changed during selector resolution');
  }
  if(await this.session()!==session)throw new DesktopError('stale_session','Windows interactive session changed');
  if(!fresh())throw new DesktopError('stale_target','Windows UIA observation expired before dispatch');
  // Explicit invoke forbids WinApp's automatic pattern/ancestor fallback.
  // Once native input is entered, a malformed receipt/error cannot prove no dispatch.
  try{
   const result=action.type==='invoke'
    ?await this.call(['invoke',selector,'--action','invoke','-w',receipt.hwnd])
    :await this.call(['set-value',selector,action.value,'-w',receipt.hwnd]);
   const exact=handle(result?.hwnd)===receipt.hwnd&&result?.elementId===selector;
   const performed=action.type!=='invoke'||(result?.pattern==='InvokePattern'&&result?.requestedAction==='invoke'&&result?.performedAction==='invoke');
   if(!exact||!performed)return {driver:this.driver,outcome:'outcome_unknown',verified:false};
  }catch{return {driver:this.driver,outcome:'outcome_unknown',verified:false};}
  return {driver:this.driver,outcome:'dispatched_unverified',verified:false};
 }
}
