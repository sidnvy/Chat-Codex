import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DesktopCore} from '../src/desktop/core.mjs';
const target={kind:'host',id:'remote'};
const action={type:'key',key:'Return'};

test('shared Core requires trusted admission and an audited driver factory',()=>{
 assert.throws(()=>new DesktopCore(),e=>e.code==='invalid_composition');
 assert.throws(()=>new DesktopCore({grantForTarget:()=>({enabled:true,driver:'stub'})}),e=>e.code==='invalid_composition');
 const src=readFileSync(new URL('../src/desktop/core.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/from ['"](?:\.\.\/resources|\.\/drivers|.*mcp|.*coder)/i);
});

test('Core runs through a portable admitted-driver binding, not a Registry or MCP adapter',async()=>{
 const io={admit:0,factory:0,status:0,observe:0,act:0},names=[];
 const core=new DesktopCore({
  grantForTarget(t){io.admit++;assert.deepEqual(t,target);return {enabled:true,driver:'remote-native'};},
  driverFactory(name,context){
   io.factory++;names.push(name);
   assert.deepEqual(context.target,target);
   assert.equal(context.grant.driver,'remote-native');
   return {
    async status(){io.status++;return {ready:true,state:'ready',session_id:'remote-session-1'};},
    async observe({mode,window_id}){io.observe++;return mode==='windows'?
     {windows:[{id:'w1',title:'Fixture'}]}:{window:{id:window_id},receipt:{window_id}};},
    async act(){io.act++;return {outcome:'dispatched_unverified',verified:false};}
   };
  }
 });
 assert.equal((await core.status(target)).ready,true);
 const observed=await core.observe({target,mode:'window',window_id:'w1'});
 const result=await core.act({target,snapshot_id:observed.snapshot_id,action});
 assert.equal(result.outcome,'dispatched_unverified');
 assert.equal(result.verified,false);
 assert.equal(result.target.id,target.id);
 assert.ok(!('content' in result)&&!('isError' in result),'no MCP envelope in Core');
 assert.deepEqual(names,['remote-native']);
 assert.equal(io.factory,1);
 assert.equal(io.act,1);
});

test('Provider binding revision invalidates a pre-rebind Desktop snapshot',async()=>{
 let revision='remote-session-binding-one',factoryCalls=0,actions=0;
 const core=new DesktopCore({
  grantForTarget:()=>({enabled:true,driver:'remote-native',binding_revision:revision}),
  driverFactory:()=>{factoryCalls++;return {
   async status(){return {ready:true,state:'ready',session_id:'same-gui-session'};},
   async observe({window_id}){return {window:{id:window_id},receipt:{window_id}};},
   async act(){actions++;return {outcome:'dispatched_unverified',verified:false};}
  };}
 });
 const seen=await core.observe({target,mode:'window',window_id:'w1'});
 revision='remote-session-binding-two';
 await assert.rejects(core.act({target,snapshot_id:seen.snapshot_id,action}),e=>e.code==='unknown_snapshot');
 assert.equal(actions,0);
 assert.equal(factoryCalls,2);
 const fresh=await core.observe({target,mode:'window',window_id:'w1'});
 assert.equal((await core.act({target,snapshot_id:fresh.snapshot_id,action})).outcome,'dispatched_unverified');
 assert.equal(actions,1);
 revision='';
 await assert.rejects(core.status(target),e=>e.code==='invalid_grant');
});

test('Core never invokes a driver when admission denies an unregistered target',async()=>{
 let called=false;
 const core=new DesktopCore({grantForTarget(){throw Error('not admitted');},driverFactory(){called=true;throw Error('must not run');}});
 await assert.rejects(core.observe({target,mode:'windows'}),/not admitted/);
 assert.equal(called,false);
});

function mutableBinding(){
 const state={grant:{enabled:true,driver:'stub',binding_revision:'one'},actions:0,now:1000,onStatus:null,onObserve:null};
 const driver={
  async status(){await state.onStatus?.();return {ready:true,session_id:'session'};},
  async observe({window_id}){await state.onObserve?.();return {windows:[{id:'w1',title:'Fixture'}],window:{id:window_id},receipt:{window_id}};},
  async act(){state.actions++;return {outcome:'dispatched_unverified',verified:false};}
 };
 const core=new DesktopCore({grantForTarget:()=>state.grant,driverFactory:()=>driver,clock:()=>state.now});
 return {state,core};
}
const see=core=>core.observe({target,mode:'window',window_id:'w1'});
const dispatch=(core,seen)=>core.act({target,snapshot_id:seen.snapshot_id,action});

test('binding revision invalidates snapshots even when factory reuses a driver object',async()=>{
 const {state,core}=mutableBinding(),seen=await see(core);
 state.grant.binding_revision='two';
 await assert.rejects(dispatch(core,seen),e=>e.code==='unknown_snapshot');
 assert.equal(state.actions,0);
});

test('observed grant revocation cannot revive a snapshot after reauthorization',async()=>{
 const {state,core}=mutableBinding(),seen=await see(core);
 state.grant.enabled=false;
 assert.equal((await core.status(target)).ready,false);
 state.grant.enabled=true;
 await assert.rejects(dispatch(core,seen),e=>e.code==='unknown_snapshot');
 assert.equal(state.actions,0);
});

for(const change of ['revoke','rebind','expire'])test('action rechecks '+change+' after asynchronous readiness',async()=>{
 const {state,core}=mutableBinding(),seen=await see(core);
 state.onStatus=()=>{
  if(change==='revoke')state.grant.enabled=false;
  if(change==='rebind')state.grant.binding_revision='two';
  if(change==='expire')state.now+=30000;
 };
 await assert.rejects(dispatch(core,seen),e=>e.code===({revoke:'desktop_not_enabled',rebind:'unknown_snapshot',expire:'stale_snapshot'}[change]));
 assert.equal(state.actions,0);
 assert.equal(core.snapshots.size,0);
});

test('Core rejects truthy non-boolean grants and malformed driver names',async()=>{
 const {state,core}=mutableBinding();
 state.grant.enabled='true';
 await assert.rejects(see(core),e=>e.code==='desktop_not_enabled');
 state.grant.enabled=true;state.grant.driver='../module';
 await assert.rejects(see(core),e=>e.code==='invalid_grant');
});

test('observation rejects an in-flight target rebind without minting a snapshot',async()=>{
 const {state,core}=mutableBinding();
 state.onObserve=()=>{state.grant.binding_revision='two';};
 await assert.rejects(see(core),e=>e.code==='unknown_snapshot');
 assert.equal(core.snapshots.size,0);
});

test('wait cannot return a match after in-flight grant revocation',async()=>{
 const {state,core}=mutableBinding();
 state.onObserve=()=>{state.grant.enabled=false;};
 await assert.rejects(core.wait({target,condition:{type:'window_present',title:'Fixture'},timeout_ms:100}),e=>e.code==='desktop_not_enabled');
});


test('status cannot report ready after an in-flight revocation',async()=>{
 const {state,core}=mutableBinding();
 state.onStatus=()=>{state.grant.enabled=false;};
 const result=await core.status(target);
 assert.equal(result.ready,false);
 assert.equal(result.state,'desktop_not_enabled');
});
