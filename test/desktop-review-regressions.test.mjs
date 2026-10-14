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


test('Desktop rejects noncanonical base64 and non-PNG captures before minting snapshots',async()=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 for(const data of ['QUJD','',png+' ',png.replace('=',''),png.slice(0,-2)+'J=',Buffer.from([0,80,78,71,13,10,26,10]).toString('base64')]){
  const d=broker({status:ready,async observe(){return {window:{id:'w1'},receipt:{window_id:'w1'},image:{mimeType:'image/png',data}};},async act(){throw Error('unexpected');}});
  await assert.rejects(d.observe({target,mode:'window',window_id:'w1'}),e=>e.code==='invalid_capture');
  assert.equal(d.snapshots.size,0);
 }
});

test('Hyprland inventories distinguish 100 visible windows from overflow',async()=>{
 for(const count of [99,100,101]){
  const clients=Array.from({length:count},(_,i)=>({address:'w'+i,title:i===99?'Scratch':'Window '+i,mapped:true}));
  clients.push({address:'hidden',hidden:true},{address:'unmapped',mapped:false});
  const hypr=new HyprlandDesktop(async(_command,args)=>JSON.stringify(args[1]==='clients'?clients:args[1]==='monitors'?[{name:'test'}]:{locked:false}),()=> 'test-session');
  const inventory=await hypr.observe({mode:'windows'});
  assert.equal(inventory.windows.length,Math.min(count,100));
  assert.equal(inventory.truncated,count>100);
  if(count===100)assert.equal((await broker(hypr).wait({target,condition:{type:'window_present',title:'Scratch'},timeout_ms:100})).matched,true);
  if(count>100)await assert.rejects(broker(hypr).wait({target,condition:{type:'window_present',title:'Scratch'},timeout_ms:100}),e=>e.code==='incomplete_observation');
 }
});


test('Peekaboo empty screenshot preserves semantic observation and snapshot-bound action',async()=>{
 const calls=[];
 const peek=new PeekabooDesktop(async(_command,args)=>{
  calls.push(args);
  const data=args[0]==='permissions'?{permissions:[{name:'Screen Recording',isGranted:true},{name:'Accessibility',isGranted:true}]}:
   args[0]==='see'?{snapshot_id:'semantic-snapshot',screenshot_raw:'',ui_elements:[{id:'B1',role:'button',label:'Save'}]}:{};
  return JSON.stringify({success:true,data});
 });
 const d=broker(peek);
 const observed=await d.observe({target,mode:'window',window_id:'123'});
 assert.ok(observed.snapshot_id);
 assert.equal(Object.hasOwn(observed,'image'),false);
 assert.equal(observed.elements[0].id,'B1');
 assert.equal((await d.act({target,snapshot_id:observed.snapshot_id,action:{type:'invoke',element_id:'B1'}})).outcome,'dispatched_unverified');
 assert.deepEqual(calls.at(-1),['click','--on','B1','--snapshot','semantic-snapshot','--json']);
});


test('Peekaboo oversized nonempty captures reach manager validation rather than being omitted',async()=>{
 const peek=new PeekabooDesktop(async(_command,args)=>JSON.stringify({success:true,data:
  args[0]==='permissions'?{permissions:[{name:'Screen Recording',isGranted:true},{name:'Accessibility',isGranted:true}]}:
  {snapshot_id:'oversized',screenshot_raw:'A'.repeat(2800000)}}));
 const d=broker(peek);
 await assert.rejects(d.observe({target,mode:'window',window_id:'123'}),e=>e.code==='invalid_capture');
 assert.equal(d.snapshots.size,0);
});
