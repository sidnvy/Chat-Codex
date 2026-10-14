import {DesktopError} from './contract.mjs';
import {localDesktopExec,parseCommandJson} from './exec.mjs';
export class PeekabooDesktop {
 constructor(run=localDesktopExec){this.run=run;this.driver='peekaboo';}
 async call(args){
  const result=parseCommandJson(await this.run('peekaboo',[...args,'--json']),this.driver);
  if(result.success!==true)throw new DesktopError(result.error?.code??'driver_error',String(result.error?.message??'Peekaboo operation failed').slice(0,350));
  return result.data??{};
 }
 async status(){
  try{
   const data=await this.call(['permissions','status']);
   const permissions=Object.fromEntries((data.permissions??[]).map(p=>[p.name,Boolean(p.isGranted)]));
   const ready=permissions['Screen Recording']===true&&permissions.Accessibility===true;
   return {driver:this.driver,state:ready?'ready':'permission_denied',ready,permissions,
    capabilities:ready?['windows','window_screenshot','accessibility','keyboard','element_click']:[]};
  }catch(e){return {driver:this.driver,state:e.code==='driver_unavailable'?'driver_unavailable':'bridge_unavailable',ready:false,capabilities:[],error:e.message};}
 }
 async observe({mode,window_id}){
  if(mode==='windows'){
   const data=await this.call(['window','list']);
   return {driver:this.driver,windows:(data.windows??[]).slice(0,100).map(a=>({id:String(a.id??a.window_id??a.windowId??''),title:String(a.title??'').slice(0,128),title_truncated:String(a.title??'').length>128,app:String(a.app??a.applicationName??'')})),truncated:(data.windows??[]).length>100};
  }
  // window_id refers to an explicitly selected application bundle/name, not an arbitrary process.
  const selector=/^[0-9]+$/.test(window_id)?['--window-id',window_id]:['--app',window_id];
  const data=await this.call(['see',...selector,'--depth','3','--max-elements','100']);
  if(!data.snapshot_id)throw new DesktopError('invalid_driver_response','Peekaboo returned no snapshot');
  const elements=(data.ui_elements??[]).slice(0,100).map(e=>({
   id:String(e.id??e.element_id??'').slice(0,128),
   role:String(e.role??'').slice(0,80),
   label:String(e.label??e.title??'').slice(0,160)
  }));
  return {driver:this.driver,window:{id:window_id,title:String(data.window_title??window_id).slice(0,128),app:window_id},
   elements,receipt:{snapshot_id:data.snapshot_id,window_id},
   ...(typeof data.screenshot_raw==='string'&&data.screenshot_raw.length>0?
    {image:{mimeType:'image/png',data:data.screenshot_raw}}:{})};
 }
 async act(receipt,action){
  let args;
  if(action.type==='type')args=['type',action.text,'--snapshot',receipt.snapshot_id];
  else if(action.type==='key')args=['press',action.key,'--snapshot',receipt.snapshot_id];
  else if(action.type==='invoke')args=['click','--on',action.element_id,'--snapshot',receipt.snapshot_id];
  else throw new DesktopError('unsupported_action','Peekaboo adapter supports type/key/element click; physical coordinates not exposed by this contract');
  await this.call(args);
  return {driver:this.driver,outcome:'dispatched_unverified',verified:false};
 }
}
