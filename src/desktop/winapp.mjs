import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DesktopError,DESKTOP_IMAGE_LIMIT_BYTES} from './contract.mjs';
import {localDesktopExec,parseCommandJson} from './exec.mjs';
export class WinappDesktop {
 constructor(run=localDesktopExec,sessionProbe=async()=>false){
  this.run=run;this.sessionProbe=sessionProbe;this.driver='winapp';
 }
 async call(args){
  const payload=parseCommandJson(await this.run('winapp',['ui',...args,'--json']),this.driver);
  if(payload.success===false||payload.error)throw new DesktopError(payload.error?.code??'driver_error',String(payload.error?.message??'winapp ui operation failed').slice(0,350));
  return payload.data??payload;
 }
 async status(){
  try{
   // UI Automation inspection can run locked, but physical input requires an unlocked user desktop.
   // Never infer interactive readiness solely from SSH/WinRM/Coder command connectivity.
   const interactive=await this.sessionProbe();
   const windows=await this.call(['list-windows']);
   return {driver:this.driver,state:interactive?'ready':'session_unverified',
    ready:interactive,inspection_available:true,window_count:Array.isArray(windows.windows)?windows.windows.length:null,
    capabilities:interactive?['windows','accessibility','element_invoke','set_value']:['windows','accessibility']};
  }catch(e){return {driver:this.driver,state:e.code==='driver_unavailable'?'driver_unavailable':'session_unverified',ready:false,capabilities:[],error:e.message};}
 }
 async observe({mode,window_id}){
  if(mode==='windows'){
   const data=await this.call(['list-windows']);
   const windows=(data.windows??data.results??[]);
   return {driver:this.driver,windows:Array.isArray(windows)?windows.slice(0,100).map(w=>({
    id:String(w.id??w.handle??w.title??'').slice(0,128),
    title:String(w.title??'').slice(0,128),app:String(w.app??w.processName??'').slice(0,128)
   })):[],truncated:Array.isArray(windows)&&windows.length>100};
  }
  // Only exact registered app names/scoped UI automation, never raw PowerShell string execution.
  const data=await this.call(['inspect','-a',window_id,'--interactive']);
  return {driver:this.driver,window:{id:window_id,title:window_id,app:window_id},elements:(data.elements??[]).slice(0,100).map(e=>({id:String(e.id??e.elementId??'').slice(0,128),role:String(e.role??e.controlType??'').slice(0,80),label:String(e.name??e.label??'').slice(0,160)})),
   receipt:{app:window_id,observed_at:Date.now()}};
 }
 async act(receipt,action){
  if(!await this.sessionProbe())throw new DesktopError('no_interactive_desktop','Interactive desktop has not been verified for this target');
  if(Date.now()-receipt.observed_at>30000)throw new DesktopError('stale_target','Windows UIA observation is stale');
  if(action.type==='invoke')await this.call(['invoke',action.element_id,'-a',receipt.app]);
  else if(action.type==='set_value')await this.call(['set-value',action.element_id,action.value,'-a',receipt.app]);
  else throw new DesktopError('unsupported_action','Windows adapter only exposes UIA invoke/set-value; no synthetic input without verified session');
  return {driver:this.driver,outcome:'dispatched_unverified',verified:false};
 }
}