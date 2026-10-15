import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopActionSchema,desktopObserveSchema,desktopActSchema,verifyDesktopDriver,DesktopError} from '../src/desktop/contract.mjs';
import {DesktopManager} from '../src/desktop/manager.mjs';
import {HyprlandDesktop} from '../src/desktop/hyprland.mjs';
import {peekabooFixture} from './fixtures/peekaboo.mjs';
import {WinappDesktop} from '../src/desktop/winapp.mjs';

const host={kind:'host',id:'desktop-host'},environment={kind:'environment',id:'dev'};
const registry=()=>({
 projects:new Map([['default',{id:'default',path:'/tmp/test'}]]),
 hosts:new Map([['desktop-host',{id:'desktop-host',project:'default',capabilities:{desktop:{enabled:true,driver:'hyprland'}}}]]),
 environments:new Map([['dev',{id:'dev',project:'default',provider:'docker'}]])
});
test('desktop contract requires strict target, snapshot and single well-typed action',()=>{
 for(const a of [
  {target:{kind:'host',id:'desktop-host',provider:'ssh'},mode:'windows'},
  {target:{kind:'host',id:'desktop-host'},mode:'window'},
  {target:{kind:'host',id:'desktop-host'},mode:'windows',window_id:'fake'},
  {target:{kind:'host',id:'desktop-host'},mode:'window',window_id:'w',workspace:'/'}
 ])assert.equal(desktopObserveSchema.safeParse(a).success,false);
 assert.equal(desktopActionSchema.safeParse({type:'type',text:'hello',shell:'whoami'}).success,false);
 assert.equal(desktopActionSchema.safeParse({type:'click',x:-1,y:0}).success,false);
 assert.equal(desktopActSchema.safeParse({target:host,snapshot_id:'latest',action:{type:'key',key:'Return'}}).success,false);
 assert.throws(()=>verifyDesktopDriver({status(){}}),/missing observe/);
});

test('desktop registry enforces explicit capability and target matching before IO',async()=>{
 let called=0,now=1234567;
 const fake={
  async status(){called++;return {driver:'hyprland',state:'ready',ready:true,capabilities:['windows']};},
  async observe(input){called++;return input.mode==='windows'?
   {driver:'hyprland',windows:[{id:'w1',title:'Scratch'}]}:
   {driver:'hyprland',window:{id:'w1',title:'Scratch'},receipt:{window_id:'w1'},image:{mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}};},
  async act(receipt,action){called++;return {outcome:'dispatched_unverified',verified:false,action_type:action.type};}
 };
 const d=new DesktopManager(registry(),{driverFactory:()=>fake,clock:()=>now});
 await assert.rejects(d.observe({target:environment,mode:'windows'}),/not enabled/);
 await assert.rejects(d.observe({target:{kind:'host',id:'unknown'},mode:'windows'}),/Unknown registered/);
 assert.equal(called,0,'invalid/admitted but not-enabled targets never reach backend');
 assert.equal((await d.status(host)).ready,true);
 assert.equal((await d.observe({target:host,mode:'windows'})).windows[0].title,'Scratch');
 const x=await d.observe({target:host,mode:'window',window_id:'w1'});
 assert.ok(x.snapshot_id&&x.image.data==='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=');
 await assert.rejects(d.act({target:environment,snapshot_id:x.snapshot_id,action:{type:'key',key:'Return'}}),/not enabled/);
 const a=await d.act({target:host,snapshot_id:x.snapshot_id,action:{type:'type',text:'probe'}});
 assert.equal(a.verified,false);
 await assert.rejects(d.act({target:host,snapshot_id:x.snapshot_id,action:{type:'type',text:'replay'}}),/Unknown|Snapshot/);
 const y=await d.observe({target:host,mode:'window',window_id:'w1'});
 now+=31000;
 await assert.rejects(d.act({target:host,snapshot_id:y.snapshot_id,action:{type:'type',text:'late'}}),/expired/);
 const w=await d.wait({target:host,condition:{type:'window_present',title:'Scratch'},timeout_ms:100});
 assert.equal(w.matched,true);
});

test('Hyprland native adapter uses JSON IPC and dispatches only focused fingerprint',async()=>{
 const calls=[],geometry={x:100,y:200,width:400,height:300};
 let moved=false;
 const run=async(cmd,args)=>{
  calls.push([cmd,...args]);
  if(cmd==='hyprctl'){
   if(args[1]==='monitors')return JSON.stringify([{name:'HEADLESS-1',width:1920,height:1080}]);
   if(args[1]==='locked')return JSON.stringify({locked:false});
   if(args[1]==='clients')return JSON.stringify([{address:'0x123',pid:123,class:'zenity',title:'Scratch',at:[100,200],size:[400,300],workspace:{name:'98'},mapped:true}]);
   if(args[1]==='activewindow')return JSON.stringify({address:'0x123',pid:123,title:moved?'Other':'Scratch',at:[100,200],size:[400,300]});
  }
  return '';
 };
 const d=new HyprlandDesktop(run,()=> 'test-session');
 assert.equal((await d.status()).ready,true);
 const windows=await d.observe({mode:'windows'});
 assert.equal(windows.windows[0].geometry.width,400);
 const receipt={window_id:'0x123',pid:123,title_digest:windows.windows[0].title_digest,geometry,session_id:(await d.status()).session_id};
 await d.act(receipt,{type:'type',text:'hello'});
 assert.ok(calls.some(x=>x[0]==='wtype'&&x.includes('hello')));
 await d.act(receipt,{type:'click',x:5,y:6});
 assert.ok(calls.some(x=>x[0]==='ydotool'&&x.includes('mousemove')));
 await assert.rejects(d.act(receipt,{type:'click',x:900,y:0}),/inside captured window/);
 moved=true;
 await assert.rejects(d.act(receipt,{type:'key',key:'Return'}),/Window identity/);
});

test('macOS Peekaboo adapter is permission-gated and receipt-pinned',async()=>{
 const {state,driver:d}=peekabooFixture();
 state.granted=false;
 assert.equal((await d.status()).state,'permission_denied');
 state.granted=true;
 assert.equal((await d.status()).ready,true);
 const s=await d.observe({mode:'window',window_id:'123'});
 assert.equal(s.receipt.snapshot_id,'pb-snap');
 await d.act(s.receipt,{type:'invoke',element_id:'B1'});
 assert.deepEqual(state.calls.at(-1),['click','--on','B1','--snapshot','pb-snap','--pid','42','--window-id','123','--bridge-socket',d.bridgeSocket,'--json']);
});

test('Windows UI Automation adapter never equates SSH execution with interactive input readiness',async()=>{
 let interactive=false;
 const commands=[];
 const run=async(cmd,args)=>{
  commands.push([cmd,...args]);
  if(args[1]==='list-windows')return JSON.stringify([{hwnd:44221,title:'Notepad',processName:'notepad',pid:1234}]);
  if(args[1]==='inspect')return JSON.stringify({windows:[{hwnd:44221,elements:[{selector:'save',type:'Button',name:'Save'}]}]});
  return '{}';
 };
 const d=new WinappDesktop(run,async()=>({ready:interactive,session_id:'fixture-session'}));
 assert.equal((await d.status()).state,'session_unverified');
 await assert.rejects(d.act({hwnd:'44221',observed_at:Date.now()},{type:'invoke',element_id:'save'}),/Interactive desktop/);
 interactive=true;
 assert.equal((await d.status()).ready,true);
 const windows=await d.observe({mode:'windows'});
 assert.equal(windows.windows[0].id,'44221');
 const observed=await d.observe({mode:'window',window_id:'44221'});
 assert.equal(observed.elements[0].id,'save');
 await d.act(observed.receipt,{type:'invoke',element_id:'save'});
 assert.ok(commands.some(x=>x.includes('invoke')&&x.includes('save')&&x.includes('-w')&&x.includes('44221')));
 assert.ok(!commands.some(x=>x.includes('-a')));
});