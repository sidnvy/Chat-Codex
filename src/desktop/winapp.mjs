import {DesktopError} from './primitives.mjs';
import {createHash} from 'node:crypto';
import {localDesktopExec,parseCommandJson} from './exec.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint=e=>digest(['selector','type','name','automationId','className'].map(k=>e[k]??null));
const safeSelector=s=>typeof s==='string'&&s.length>0&&s.length<=128&&!/^[-@]/.test(s);
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
 const pending=roots.map(element=>({element,depth:0})).reverse(),elements=[],promoted=[],evidence=[],ids=new Set();
 let visited=0;
 while(pending.length){
  const {element:e,depth}=pending.pop();
  if(++visited>1000||depth>32)throw new DesktopError('invalid_driver_response','WinApp element tree exceeds inspection bounds');
  const id=String(e?.selector??e?.id??e?.elementId??e?.automationId??e?.slug??'');
  if(id&&id.length<=128){
   if(ids.has(id))throw new DesktopError('invalid_driver_response','Duplicate WinApp element selector');
   ids.add(id);
   if(elements.length<100){
    evidence.push({id,fingerprint:fingerprint(e),type:e.type,enabled:e.isEnabled===true,offscreen:e.isOffscreen===true,invokable:e.isInvokable===true});
    elements.push({id,role:String(e.role??e.type??e.controlType??'').slice(0,80),label:String(e.name??e.label??'').slice(0,160),...(typeof e.value==='string'?{value:e.value.slice(0,200)}:{})});
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
 return {elements,promoted,evidence};
}
export class WinappDesktop {
 constructor(run=localDesktopExec,sessionProbe=async()=>false,{windowProbe=null,captureProbe=null,maxImageBytes=393216}={}){
  this.run=run;this.sessionProbe=sessionProbe;this.driver='winapp';
  this.windowProbe=windowProbe;this.captureProbe=captureProbe;this.maxImageBytes=maxImageBytes;
 }
 async call(args){
  const payload=parseCommandJson(await this.run('winapp',['ui',...args,'--json']),this.driver);
  if(payload?.success===false||payload?.error)throw new DesktopError(payload.error?.code??'driver_error',String(payload.error?.message??'winapp ui operation failed').slice(0,350));
  return payload?.data??payload;
 }
 async listWindows(){
  const data=await this.call(['list-windows']),raw=windowArray(data);
  const windows=raw.map(projectWindow).filter(Boolean);
  const duplicate=new Set(windows.map(w=>w.hwnd)).size!==windows.length;
  return {windows,truncated:raw.length>100||windows.length!==raw.length||duplicate||
   data?.truncated===true||data?.complete===false||data?.hasMore===true};
 }
 async verifiedWindows({title}={}){
  if(!this.windowProbe)throw new DesktopError('driver_unavailable','Native inventory proof required');
  const inventory=await this.observe({mode:'windows'}),output=[];let incomplete=inventory.truncated;
  for(const w of inventory.windows){
   if(title!==undefined&&w.title!==title)continue;
   try{
    const proof=await this.nativeWindow(w.hwnd);
    if(proof.pid!==w.pid)throw new DesktopError('stale_target','Native owner mismatch');
    if(title!==undefined&&proof.title!==title)continue;
    output.push({...w,title:proof.title.slice(0,128),title_truncated:proof.title.length>128});
   }catch{incomplete=true;}
  }
  return {...inventory,windows:output,truncated:incomplete};
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
 async nativeWindow(hwnd){
  if(!this.windowProbe)return null;
  const p=await this.windowProbe(hwnd);
  if(!p||p.hwnd!==hwnd||!processId(p.pid)||!/^[1-9][0-9]{0,19}$/.test(p.start_time)||
   !Number.isInteger(p.session_id)||p.session_id<=0||p.session_id>=0xffffffff||typeof p.session_generation!=='string'||!/^[a-f0-9]{64}$/.test(p.session_generation)||p.same_user!==true||p.thread_desktop!=='Default'||p.thread_receiving!==true||
   typeof p.user_sid!=='string'||!/^S-1-[0-9]+(?:-[0-9]+){1,15}$/.test(p.user_sid)||
   typeof p.title!=='string'||p.title.length>32767)
   throw new DesktopError('stale_target','Native window identity unavailable');
  const identity={hwnd,pid:processId(p.pid),start_time:p.start_time,session_id:p.session_id,session_generation:p.session_generation,user_sid:p.user_sid,thread_desktop:p.thread_desktop,thread_receiving:p.thread_receiving,title_digest:digest(p.title)};
  Object.defineProperty(identity,'title',{value:p.title});return identity;
 }
 async assertNative(hwnd,expected){
  if(this.windowProbe&&digest(await this.nativeWindow(hwnd))!==digest(expected))throw new DesktopError('stale_target','Native window identity changed');
 }
 async captureWindow(selected,identity){
  const captured=await this.captureProbe(selected.hwnd);
  if(digest(captured?.identity)!==digest(identity))throw new DesktopError('stale_target','Capture identity changed');
  const png=Buffer.from(captured?.image?.data??'','base64');
  if(png.length<100||png.length>this.maxImageBytes||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new DesktopError('invalid_capture','Invalid PNG');
  return {mimeType:'image/png',data:png.toString('base64')};
 }
 async observe({mode,window_id}){
  if(mode==='windows'){
   const {windows,truncated}=await this.listWindows();
   return {driver:this.driver,windows:windows.slice(0,100),truncated};
  }
  const session=await this.session();
  const selected=await this.exactWindow(window_id);
  const identity=await this.nativeWindow(selected.hwnd);
  if(identity&&identity.pid!==selected.pid)throw new DesktopError('stale_target','Native owner mismatch');
  if(identity){selected.title=identity.title.slice(0,128);selected.title_truncated=identity.title.length>128;}
  const data=await this.call(['inspect','-w',selected.hwnd,...(this.windowProbe?['--depth','8']:['--interactive'])]);
  const {elements,promoted,evidence}=flattenElements(unwrapElements(data,selected));
  const image=this.captureProbe?await this.captureWindow(selected,identity):null;
  const current=await this.exactWindow(window_id);
  if(current.pid!==selected.pid)throw new DesktopError('stale_target','HWND was reused during observation');
  if(await this.session()!==session)throw new DesktopError('stale_session','Windows interactive session changed');
  await this.assertNative(selected.hwnd,identity);
  return {driver:this.driver,window:selected,elements,...(image?{image}:{}),
   receipt:{hwnd:selected.hwnd,pid:selected.pid,session_id:session,element_ids:elements.map(e=>e.id),promoted_elements:this.windowProbe?promoted.map(({name,...e})=>({...e,name_digest:digest(name)})):promoted,...(identity?{identity,element_evidence:evidence}:{}),observed_at:Date.now()}};
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
  if(this.windowProbe){
   if(!safeSelector(selector))throw new DesktopError('stale_target','Unsafe selector');
   await this.assertNative(receipt.hwnd,receipt.identity);
   const inspect=await this.call(['inspect','-w',receipt.hwnd,'--depth','8']);
   const freshElements=flattenElements(unwrapElements(inspect,current)).evidence;
   const match=freshElements.find(e=>e.id===selector),old=receipt.element_evidence?.find(e=>e.id===selector);
   if(!match||!old||match.fingerprint!==old.fingerprint||!match.enabled||match.offscreen)throw new DesktopError('stale_target','Element identity or state changed');
   if(action.type==='invoke'&&!match.invokable)throw new DesktopError('unsupported_action','Element is not invokable');
   if(action.type==='set_value'&&(match.type!=='Edit'||typeof action.value!=='string'||action.value.length>500||/^[-@]/.test(action.value)||action.value.includes('\0')))throw new DesktopError('unsupported_action','Unsupported edit value');
  }
  const promoted=receipt.promoted_elements?.find(e=>e.id===selector);
  if(promoted){
   // --type selects upstream's constrained query path, which retains runtime-ID
   // slugs; ordinary search promotes AutomationIds again and cannot resolve this.
   const search=await this.call(['search',selector,'-w',receipt.hwnd,'--type',promoted.type,'--max','2']);
   const match=search?.matches?.[0];
   if(search?.matchCount!==1||search?.hasMore!==false||!Array.isArray(search.matches)||search.matches.length!==1||
    match?.automationId!==promoted.automation_id||match?.type!==promoted.type||(promoted.name_digest?digest(match?.name??null)!==promoted.name_digest:(match?.name??null)!==promoted.name)||
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
  await this.assertNative(receipt.hwnd,receipt.identity);
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
