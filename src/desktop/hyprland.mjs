import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DesktopError,DESKTOP_IMAGE_LIMIT_BYTES} from './contract.mjs';
import {localDesktopExec,parseCommandJson} from './exec.mjs';
const bounded=s=>String(s??'').slice(0,128);
export class HyprlandDesktop {
 constructor(run=localDesktopExec){this.run=run;this.driver='hyprland';}
 async read(name){return parseCommandJson(await this.run('hyprctl',['-j',name]),'hyprctl');}
 async status(){
  try{
   const [monitors,locked]=await Promise.all([this.read('monitors'),this.read('locked')]);
   if(!Array.isArray(monitors)||!monitors.length)return {driver:this.driver,state:'no_session',ready:false,capabilities:[]};
   const state=locked.locked?'locked':'ready';
   return {driver:this.driver,state,ready:state==='ready',session:'active',
    monitors:monitors.slice(0,8).map(x=>({name:bounded(x.name),width:x.width,height:x.height})),
    capabilities:['windows','window_screenshot','keyboard','pointer'],
    semantic_elements:false};
  }catch(e){return {driver:this.driver,state:e.code==='driver_unavailable'?'driver_unavailable':'no_session',ready:false,capabilities:[],error:String(e.message).slice(0,200)};}
 }
 async windows(){
  const raw=await this.read('clients');
  if(!Array.isArray(raw))throw new DesktopError('invalid_driver_response','Hyprland clients must be an array');
  return raw.filter(x=>x.mapped!==false&&x.hidden!==true).slice(0,100).map(x=>({
   id:bounded(x.address),title:bounded(x.title),title_truncated:String(x.title??'').length>128,app:bounded(x.class),
   workspace:bounded(x.workspace?.name),geometry:{x:x.at?.[0],y:x.at?.[1],width:x.size?.[0],height:x.size?.[1]}
  }));
 }
 async observe({mode,window_id}){
  const windows=await this.windows();
  if(mode==='windows')return {driver:this.driver,windows,truncated:windows.length>=100};
  const window=windows.find(x=>x.id===window_id);
  if(!window)throw new DesktopError('target_not_found','Exact window not found');
  const active=await this.read('activewindow');
  if(active.address!==window.id||active.title!==window.title)throw new DesktopError('not_foreground','Target window must be active for screenshot and input');
  const {x,y,width,height}=window.geometry;
  if(![x,y,width,height].every(Number.isInteger)||width<1||height<1||width>8192||height>8192)throw new DesktopError('invalid_window','Invalid window bounds');
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'cc-desktop-'));
  try{
   const dest=path.join(tmp,'capture.png');
   await this.run('grim',['-g',x+','+y+' '+width+'x'+height,'-t','png',dest]);
   const data=await fs.readFile(dest);
   if(data.length<100||data.length>DESKTOP_IMAGE_LIMIT_BYTES||data.subarray(1,4).toString()!=='PNG')
    throw new DesktopError('invalid_capture','Captured window image is invalid or exceeds 2 MiB');
   return {driver:this.driver,window,image:{mimeType:'image/png',data:data.toString('base64')},
    receipt:{window_id:window.id,title:window.title,geometry:window.geometry}};
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
 }
 async act(receipt,action){
  const active=await this.read('activewindow');
  if(active.address!==receipt.window_id||active.title!==receipt.title||JSON.stringify({
   x:active.at?.[0],y:active.at?.[1],width:active.size?.[0],height:active.size?.[1]
  })!==JSON.stringify(receipt.geometry))throw new DesktopError('stale_target','Window identity/geometry changed since observation');
  if(action.type==='type'){
   await this.run('wtype',['--',action.text]);
  }else if(action.type==='key'){
   if(!/^(Return|Escape|Tab|BackSpace|space|[A-Za-z0-9])$/.test(action.key))throw new DesktopError('unsupported_action','Key is not in the audited Linux allowlist');
   await this.run('wtype',['-k',action.key]);
  }else if(action.type==='click'){
   const {x,y,width,height}=receipt.geometry;
   if(action.x>=width||action.y>=height)throw new DesktopError('out_of_bounds','Click must be inside captured window');
   await this.run('ydotool',['mousemove','--absolute','-x',String(x+action.x),'-y',String(y+action.y)]);
   await this.run('ydotool',['click','0xC0']);
  }else throw new DesktopError('unsupported_action','Hyprland supports text, key and bounded coordinate click only');
  return {outcome:'dispatched_unverified',verified:false,driver:this.driver};
 }
}
