import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopManager} from '../src/desktop/manager.mjs';
import {HyprlandDesktop} from '../src/desktop/hyprland.mjs';
import {PeekabooDesktop} from '../src/desktop/peekaboo.mjs';
import {WinappDesktop} from '../src/desktop/winapp.mjs';

function broker(driver,clock=()=>Date.now()){
 const entry={id:'local',project:'p',capabilities:{desktop:{enabled:true,driver:'mock'}}};
 const registry={projects:new Map([['p',{id:'p'}]]),hosts:new Map([['local',entry]]),environments:new Map()};
 return new DesktopManager(registry,{driverFactory:()=>driver,clock});
}
const target={kind:'host',id:'local'};
const ready=async()=>({ready:true,state:'ready',session_id:'session-one'});

test('Desktop receipt binds every supplied native window identity',async()=>{
 for(const receipt of [{window_id:'another'},{hwnd:'another'},{window_id:'w1',hwnd:'another'},{}]){
  let dispatched=0;
  const d=broker({status:ready,async observe(){return {window:{id:'w1'},receipt};},
   async act(){dispatched++;return {outcome:'dispatched_unverified',verified:false};}});
  await assert.rejects(d.observe({target,mode:'window',window_id:'w1'}),e=>e.code==='invalid_driver_response');
  assert.equal(dispatched,0);
  assert.equal(d.snapshots.size,0);
 }
 const accepted=broker({status:ready,async observe(){return {window:{id:'44221'},receipt:{hwnd:44221}};},
  async act(){return {outcome:'dispatched_unverified',verified:false};}});
 assert.ok((await accepted.observe({target,mode:'window',window_id:'44221'})).snapshot_id);
});

test('Desktop wait never calls a late match success',async()=>{
 for(const stage of ['status','observe']){
  let now=1000;
  const driver={
   async status(){if(stage==='status')now+=101;return {ready:true,state:'ready'};},
   async observe(){if(stage==='observe')now+=101;return {windows:[{id:'w1',title:'Scratch'}]};},
   async act(){throw Error('no act expected');}
  };
  const d=broker(driver,()=>now);
  assert.deepEqual(await d.wait({target,condition:{type:'window_present',title:'Scratch'},timeout_ms:100}),
   {target,matched:false,termination:'timeout'});
 }
});

test('all built-in window catalogs mark truncated titles so wait cannot treat prefixes as exact',async()=>{
 const long='L'.repeat(130);
 const hypr=new HyprlandDesktop(async(command,args)=>{
  if(args[1]==='clients')return JSON.stringify([{address:'0x123',title:long,class:'app',mapped:true}]);
  return JSON.stringify([]);
 });
 const h=await hypr.observe({mode:'windows'});
 assert.equal(h.windows[0].title,long.slice(0,128));
 assert.equal(h.windows[0].title_truncated,true);
 const peek=new PeekabooDesktop(async()=>JSON.stringify({success:true,data:{windows:[{id:123,title:long,app:'demo'}]}}));
 const p=await peek.observe({mode:'windows'});
 assert.equal(p.windows[0].title,long.slice(0,128));
 assert.equal(p.windows[0].title_truncated,true);
 const win=new WinappDesktop(async()=>JSON.stringify([{hwnd:44221,title:long,processName:'demo'}]));
 const w=await win.observe({mode:'windows'});
 assert.equal(w.windows[0].title,long.slice(0,128));
 assert.equal(w.windows[0].title_truncated,true);
});
