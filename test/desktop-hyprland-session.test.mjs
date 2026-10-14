import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {HyprlandDesktop} from '../src/desktop/hyprland.mjs';

function fixture(){
 const state={session:'compositor-generation-one',lock:{locked:false},pid:21,title:'Scratch',afterCapture:null,afterDispatch:null,dispatches:[]};
 const window=()=>({address:'0x123',pid:state.pid,title:state.title,class:'scratch',at:[10,20],size:[200,100],mapped:true});
 const run=async(command,args)=>{
  if(command==='hyprctl'){
   if(args[1]==='monitors')return JSON.stringify([{name:'test',width:800,height:600}]);
   if(args[1]==='locked')return JSON.stringify(state.lock);
   if(args[1]==='clients')return JSON.stringify([window()]);
   if(args[1]==='activewindow')return JSON.stringify(window());
  }
  if(command==='grim'){
   const png=Buffer.alloc(100);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
   await fs.writeFile(args.at(-1),png);
   state.afterCapture?.();
  }else {state.dispatches.push(command);state.afterDispatch?.();}
  return '';
 };
 const driver=new HyprlandDesktop(run,()=>state.session);
 return {state,driver,observe:()=>driver.observe({mode:'window',window_id:'0x123'})};
}

test('Hyprland requires explicit unlocked evidence and session generation',async()=>{
 for(const lock of [{},{locked:null},{locked:0},{locked:'false'},null]){
  const {state,driver}=fixture();state.lock=lock;
  assert.equal((await driver.status()).state,'session_unverified');
 }
 const {state,driver}=fixture();state.session='';
 assert.equal((await driver.status()).ready,false);
 state.session='private-compositor-signature';state.lock={locked:true};
 const locked=await driver.status();assert.equal(locked.ready,false);assert.deepEqual(locked.capabilities,[]);
 state.lock={locked:false};const ready=await driver.status();
 assert.equal(ready.ready,true);assert.match(ready.session_id,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(ready).includes(state.session));
});

test('Hyprland rejects process reuse, session replacement and lock before mutation',async()=>{
 for(const change of [state=>state.pid++,state=>state.session='new-generation',state=>state.lock={locked:true},state=>state.pid=null]){
  const {state,driver,observe}=fixture();const {receipt}=await observe();change(state);
  await assert.rejects(driver.act(receipt,{type:'type',text:'must not dispatch'}));
  assert.deepEqual(state.dispatches,[]);
 }
});

test('Hyprland refuses changed identity or lock during capture',async()=>{
 for(const change of [state=>state.pid++,state=>state.session='new-generation',state=>state.title='Other',state=>state.lock={locked:true}]){
  const {state,observe}=fixture();state.afterCapture=()=>change(state);
  await assert.rejects(observe());assert.deepEqual(state.dispatches,[]);
 }
});

test('Hyprland requires process evidence and preserves valid observed dispatch',async()=>{
 const {state,driver,observe}=fixture();state.pid=null;await assert.rejects(observe());
 state.pid=21;const {receipt}=await observe();
 assert.equal(receipt.pid,21);assert.equal(receipt.session_id,(await driver.status()).session_id);
 assert.equal((await driver.act(receipt,{type:'type',text:'hello'})).outcome,'dispatched_unverified');
 assert.deepEqual(state.dispatches,['wtype']);
});


test('Hyprland reports uncertain outcome when target changes after pointer movement',async()=>{
 const {state,driver,observe}=fixture();const {receipt}=await observe();
 state.afterDispatch=()=>state.pid++;
 const result=await driver.act(receipt,{type:'click',x:5,y:5});
 assert.equal(result.outcome,'outcome_unknown');assert.equal(result.verified,false);
 assert.deepEqual(state.dispatches,['ydotool']); // movement only, never a blind click
});

test('Hyprland captures long titles while binding the complete private title',async()=>{
 const {state,driver,observe}=fixture();state.title='x'.repeat(128)+' private suffix one';
 const inventory=await driver.observe({mode:'windows'});
 assert.equal(inventory.windows[0].title,'x'.repeat(128));
 assert.equal(inventory.windows[0].title_truncated,true);
 assert.ok(!Object.keys(inventory.windows[0]).includes('title_digest'));
 assert.ok(!JSON.stringify(inventory).includes('private suffix'));
 assert.equal(JSON.parse(JSON.stringify(inventory)).windows[0].title_digest,undefined);
 const observed=await observe();assert.ok(observed.image);assert.match(observed.receipt.title_digest,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(observed).includes('private suffix'));
 assert.equal((await driver.act(observed.receipt,{type:'key',key:'Return'})).outcome,'dispatched_unverified');
 state.title='x'.repeat(128)+' private suffix two';
 await assert.rejects(driver.act(observed.receipt,{type:'key',key:'Return'}),e=>e.code==='stale_target');
 assert.equal(state.dispatches.length,1);
});
