import {DesktopError} from './contract.mjs';
import {localDesktopExec,parseCommandJson} from './exec.mjs';

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
 return {id:hwnd,hwnd,title:String(w.title??'').slice(0,128),
  app:String(w.app??w.processName??w.process_name??'').slice(0,128),
  ...(w.pid!==undefined||w.processId!==undefined?{pid:String(w.pid??w.processId).slice(0,32)}:{})};
}
function unwrapElements(data,hwnd){
 const windows=data?.windows;
 if(Array.isArray(windows)){
  const found=windows.find(w=>handle(w?.hwnd??w?.HWND)===hwnd);
  if(!found){
   // Some WinApp inspect responses omit hwnd for a single explicitly scoped -w target.
   if(windows.length!==1||handle(windows[0]?.hwnd??windows[0]?.HWND))throw new DesktopError('stale_target','WinApp inspect window no longer matches selected HWND');
   return Array.isArray(windows[0]?.elements)?windows[0].elements:[];
  }
  return Array.isArray(found.elements)?found.elements:[];
 }
 if(Array.isArray(data?.elements))return data.elements; // older response compatibility
 throw new DesktopError('invalid_driver_response','WinApp inspect returned no recognized elements envelope');
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
 async status(){
  try{
   // Shell/SSH connectivity is not proof of a live, unlocked Windows user desktop.
   const interactive=await this.sessionProbe();
   const {windows}=await this.listWindows();
   return {driver:this.driver,state:interactive?'ready':'session_unverified',
    ready:interactive,inspection_available:true,window_count:windows.length,
    capabilities:interactive?['windows','accessibility','element_invoke','set_value']:['windows','accessibility']};
  }catch(e){return {driver:this.driver,state:e.code==='driver_unavailable'?'driver_unavailable':'session_unverified',ready:false,capabilities:[],error:e.message};}
 }
 async exactWindow(id){
  const hwnd=handle(id);
  if(!hwnd)throw new DesktopError('invalid_window','A discovered numeric HWND is required; app names and titles are not exact window targets');
  const {windows}=await this.listWindows();
  const selected=windows.find(w=>w.hwnd===hwnd);
  if(!selected)throw new DesktopError('target_not_found','Selected HWND is no longer present');
  return selected;
 }
 async observe({mode,window_id}){
  if(mode==='windows'){
   const {windows,truncated}=await this.listWindows();
   return {driver:this.driver,windows:windows.slice(0,100),truncated};
  }
  const selected=await this.exactWindow(window_id);
  const data=await this.call(['inspect','-w',selected.hwnd,'--interactive']);
  const elements=unwrapElements(data,selected.hwnd).slice(0,100).map(e=>({
   id:String(e.selector??e.id??e.elementId??e.automationId??e.slug??'').slice(0,128),
   role:String(e.role??e.type??e.controlType??'').slice(0,80),
   label:String(e.name??e.label??'').slice(0,160)
  })).filter(e=>e.id);
  return {driver:this.driver,window:selected,elements,
   receipt:{hwnd:selected.hwnd,pid:selected.pid??null,observed_at:Date.now()}};
 }
 async act(receipt,action){
  if(!await this.sessionProbe())throw new DesktopError('no_interactive_desktop','Interactive desktop has not been verified for this target');
  if(!receipt||!handle(receipt.hwnd)||!Number.isFinite(receipt.observed_at)||Date.now()-receipt.observed_at>30000||Date.now()<receipt.observed_at)
   throw new DesktopError('stale_target','Windows UIA observation is stale or invalid');
  const current=await this.exactWindow(receipt.hwnd);
  if(receipt.pid&&current.pid&&receipt.pid!==current.pid)throw new DesktopError('stale_target','HWND was reused by another process');
  if(action.type==='invoke')await this.call(['invoke',action.element_id,'-w',receipt.hwnd]);
  else if(action.type==='set_value')await this.call(['set-value',action.element_id,action.value,'-w',receipt.hwnd]);
  else throw new DesktopError('unsupported_action','Windows adapter exposes only UIA invoke/set-value');
  return {driver:this.driver,outcome:'dispatched_unverified',verified:false};
 }
}
