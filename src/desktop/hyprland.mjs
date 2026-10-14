import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {DesktopError,DESKTOP_IMAGE_LIMIT_BYTES} from './contract.mjs';
import {localDesktopExec,parseCommandJson} from './exec.mjs';
const bounded=s=>String(s??'').slice(0,128);
export class HyprlandDesktop {
 constructor(run=localDesktopExec,sessionIdentity=()=>process.env.HYPRLAND_INSTANCE_SIGNATURE){
  this.run=run;this.sessionIdentity=sessionIdentity;this.driver='hyprland';
 }
 sessionId(){
  const identity=this.sessionIdentity();
  if(typeof identity!=='string'||!identity.trim()||identity.length>1024)
   throw new DesktopError('session_unverified','Compositor session identity is unavailable');
  return createHash('sha256').update(identity).digest('hex');
 }
 async read(name){return parseCommandJson(await this.run('hyprctl',['-j',name]),'hyprctl');}
 async status(){
  try{
   const session_id=this.sessionId();
   const [monitors,locked]=await Promise.all([this.read('monitors'),this.read('locked')]);
   if(!Array.isArray(monitors)||!monitors.length)return {driver:this.driver,state:'no_session',ready:false,capabilities:[]};
   if(typeof locked?.locked!=='boolean'||session_id!==this.sessionId())
    return {driver:this.driver,state:'session_unverified',ready:false,capabilities:[]};
   const state=locked.locked?'locked':'ready';
   return {driver:this.driver,state,ready:state==='ready',session:'active',session_id,
    monitors:monitors.slice(0,8).map(x=>({name:bounded(x.name),width:x.width,height:x.height})),
    capabilities:state==='ready'?['windows','window_screenshot','keyboard','pointer']:[],
    semantic_elements:false};
  }catch(e){return {driver:this.driver,state:['driver_unavailable','session_unverified'].includes(e.code)?e.code:'no_session',ready:false,capabilities:[],error:String(e.message).slice(0,200)};}
 }
 async inventory(){
  const raw=await this.read('clients');
  if(!Array.isArray(raw))throw new DesktopError('invalid_driver_response','Hyprland clients must be an array');
  const visible=raw.filter(x=>x.mapped!==false&&x.hidden!==true);
  const windows=visible.slice(0,100).map(x=>({
   id:bounded(x.address),title:bounded(x.title),title_truncated:String(x.title??'').length>128,app:bounded(x.class),
   pid:Number.isSafeInteger(x.pid)&&x.pid>0?x.pid:null,
   workspace:bounded(x.workspace?.name),geometry:{x:x.at?.[0],y:x.at?.[1],width:x.size?.[0],height:x.size?.[1]}
  }));
  return {windows,truncated:visible.length>100};
 }
 async windows(){return (await this.inventory()).windows;}
 async assertReceipt(receipt){
  const status=await this.status();
  if(!status.ready)throw new DesktopError(status.state,'Desktop session is not ready');
  if(!receipt||receipt.session_id!==status.session_id||!Number.isSafeInteger(receipt.pid)||receipt.pid<=0)
   throw new DesktopError('stale_target','Window identity or session changed since observation');
  const active=await this.read('activewindow');
  if(this.sessionId()!==receipt.session_id||active.address!==receipt.window_id||active.pid!==receipt.pid||active.title!==receipt.title||JSON.stringify({
   x:active.at?.[0],y:active.at?.[1],width:active.size?.[0],height:active.size?.[1]
  })!==JSON.stringify(receipt.geometry))throw new DesktopError('stale_target','Window identity/geometry changed since observation');
 }
 async observe({mode,window_id}){
  const {windows,truncated}=await this.inventory();
  if(mode==='windows')return {driver:this.driver,windows,truncated};
  const window=windows.find(x=>x.id===window_id);
  if(!window)throw new DesktopError('target_not_found','Exact window not found');
  const receipt={window_id:window.id,pid:window.pid,title:window.title,geometry:window.geometry,session_id:this.sessionId()};
  await this.assertReceipt(receipt);
  const {x,y,width,height}=window.geometry;
  if(![x,y,width,height].every(Number.isInteger)||width<1||height<1||width>8192||height>8192)throw new DesktopError('invalid_window','Invalid window bounds');
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'cc-desktop-'));
  try{
   const dest=path.join(tmp,'capture.png');
   await this.run('grim',['-g',x+','+y+' '+width+'x'+height,'-t','png',dest]);
   const data=await fs.readFile(dest);
   if(data.length<100||data.length>DESKTOP_IMAGE_LIMIT_BYTES||data.subarray(1,4).toString()!=='PNG')
    throw new DesktopError('invalid_capture','Captured window image is invalid or exceeds 2 MiB');
   await this.assertReceipt(receipt);
   return {driver:this.driver,window,image:{mimeType:'image/png',data:data.toString('base64')},
    receipt};
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
 }
 async act(receipt,action){
  await this.assertReceipt(receipt);
  if(action.type==='type'){
   await this.run('wtype',['--',action.text]);
  }else if(action.type==='key'){
   if(!/^(Return|Escape|Tab|BackSpace|space|[A-Za-z0-9])$/.test(action.key))throw new DesktopError('unsupported_action','Key is not in the audited Linux allowlist');
   await this.run('wtype',['-k',action.key]);
  }else if(action.type==='click'){
   const {x,y,width,height}=receipt.geometry;
   if(action.x>=width||action.y>=height)throw new DesktopError('out_of_bounds','Click must be inside captured window');
   await this.run('ydotool',['mousemove','--absolute','-x',String(x+action.x),'-y',String(y+action.y)]);
   try{
    await this.assertReceipt(receipt);
    await this.run('ydotool',['click','0xC0']);
   }catch{
    // Pointer movement has already happened; never describe this as no dispatch.
    return {outcome:'outcome_unknown',verified:false,driver:this.driver};
   }
  }else throw new DesktopError('unsupported_action','Hyprland supports text, key and bounded coordinate click only');
  return {outcome:'dispatched_unverified',verified:false,driver:this.driver};
 }
}
